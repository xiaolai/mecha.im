package event

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"mecha.im/internal/store"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
}

func TestCreateAndGet(t *testing.T) {
	s := testStore(t)
	ev := &Event{
		Source:    "github",
		Type:      "pull_request.opened",
		RepoOwner: "owner",
		RepoName:  "repo",
		Number:    42,
		Sender:    "user",
		Payload:   Payload{"title": "Fix bug"},
		Raw:       json.RawMessage(`{"action":"opened"}`),
	}
	if err := s.Create(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
	if ev.ID == "" {
		t.Error("expected ID")
	}

	got, err := s.Get(context.Background(), ev.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Type != "pull_request.opened" {
		t.Errorf("type = %q", got.Type)
	}
	if got.State != StateReceived {
		t.Errorf("state = %q", got.State)
	}
	if got.Payload["title"] != "Fix bug" {
		t.Errorf("payload = %v", got.Payload)
	}
}

func TestDeliveryDedupe(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()

	ev := &Event{DeliveryID: "abc-123", Source: "github", Type: "push"}
	s.Create(ctx, ev)

	exists, err := s.DeliveryExists(ctx, "abc-123")
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Error("should find existing delivery")
	}
	exists2, _ := s.DeliveryExists(ctx, "xyz-999")
	if exists2 {
		t.Error("should not find unknown delivery")
	}
	exists3, _ := s.DeliveryExists(ctx, "")
	if exists3 {
		t.Error("empty delivery should return false")
	}
}

func TestStateTransitions(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()

	ev := &Event{Source: "github", Type: "push"}
	s.Create(ctx, ev)

	s.SetMatched(ctx, ev.ID, "worker-1")
	got, _ := s.Get(ctx, ev.ID)
	if got.State != StateMatched || got.WorkerName != "worker-1" {
		t.Errorf("after match: state=%q worker=%q", got.State, got.WorkerName)
	}

	s.SetDispatched(ctx, ev.ID, "task-abc")
	got, _ = s.Get(ctx, ev.ID)
	if got.State != StateDispatched || got.TaskID != "task-abc" {
		t.Errorf("after dispatch: state=%q task=%q", got.State, got.TaskID)
	}

	s.SetCompleted(ctx, ev.ID)
	got, _ = s.Get(ctx, ev.ID)
	if got.State != StateCompleted {
		t.Errorf("after complete: state=%q", got.State)
	}
}

func TestSetSkipped(t *testing.T) {
	s := testStore(t)
	ev := &Event{Source: "github", Type: "push"}
	s.Create(context.Background(), ev)
	s.SetSkipped(context.Background(), ev.ID)
	got, _ := s.Get(context.Background(), ev.ID)
	if got.State != StateSkipped {
		t.Errorf("state = %q", got.State)
	}
}

func TestList(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	s.Create(ctx, &Event{Source: "github", Type: "push"})
	s.Create(ctx, &Event{Source: "github", Type: "pull_request.opened"})

	all, _ := s.List(ctx, "")
	if len(all) != 2 {
		t.Errorf("all = %d", len(all))
	}
	received, _ := s.List(ctx, "received")
	if len(received) != 2 {
		t.Errorf("received = %d", len(received))
	}
}

func TestGetNotFound(t *testing.T) {
	s := testStore(t)
	_, err := s.Get(context.Background(), "ghost")
	if err == nil {
		t.Error("expected error")
	}
}
