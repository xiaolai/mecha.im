package events

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"mecha.im/internal/store"
)

func testDedupStore(t *testing.T) *Store {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
}

func TestDedupKeyActive_NoActive(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	active, err := s.DedupKeyActive(ctx, "nonexistent-key")
	if err != nil {
		t.Fatal(err)
	}
	if active {
		t.Error("expected false for nonexistent dedup key")
	}
}

func TestDedupKeyActive_ActiveExists(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	// Create an event with a dedup key (it starts in "received" state, which is active)
	ev := &Event{
		DedupKey: "cron:daily:abc",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}

	active, err := s.DedupKeyActive(ctx, "cron:daily:abc")
	if err != nil {
		t.Fatal(err)
	}
	if !active {
		t.Error("expected true for active dedup key (event in received state)")
	}
}

func TestDedupKeyActive_MatchedIsActive(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	ev := &Event{
		DedupKey: "poll:github:123",
		Source:   "github",
		Type:     "pull_request.opened",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMatched(ctx, ev.ID, "worker-1"); err != nil {
		t.Fatal(err)
	}

	active, err := s.DedupKeyActive(ctx, "poll:github:123")
	if err != nil {
		t.Fatal(err)
	}
	if !active {
		t.Error("expected true for matched event (still active)")
	}
}

func TestDedupKeyActive_DispatchedIsActive(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	ev := &Event{
		DedupKey: "poll:dispatch:456",
		Source:   "github",
		Type:     "push",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}
	s.SetMatched(ctx, ev.ID, "w")
	s.SetDispatched(ctx, ev.ID, "task-1")

	active, err := s.DedupKeyActive(ctx, "poll:dispatch:456")
	if err != nil {
		t.Fatal(err)
	}
	if !active {
		t.Error("expected true for dispatched event (still active)")
	}
}

func TestDedupKeyActive_CompletedDoesNotBlock(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	ev := &Event{
		DedupKey: "cron:completed:789",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}
	s.SetMatched(ctx, ev.ID, "w")
	s.SetDispatched(ctx, ev.ID, "t")
	s.SetCompleted(ctx, ev.ID)

	active, err := s.DedupKeyActive(ctx, "cron:completed:789")
	if err != nil {
		t.Fatal(err)
	}
	if active {
		t.Error("expected false for completed event (terminal state)")
	}
}

func TestDedupKeyActive_FailedDoesNotBlock(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	ev := &Event{
		DedupKey: "cron:failed:101",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}
	s.SetFailed(ctx, ev.ID)

	active, err := s.DedupKeyActive(ctx, "cron:failed:101")
	if err != nil {
		t.Fatal(err)
	}
	if active {
		t.Error("expected false for failed event (terminal state)")
	}
}

func TestDedupKeyActive_SkippedDoesNotBlock(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	ev := &Event{
		DedupKey: "cron:skipped:102",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}
	s.SetSkipped(ctx, ev.ID)

	active, err := s.DedupKeyActive(ctx, "cron:skipped:102")
	if err != nil {
		t.Fatal(err)
	}
	if active {
		t.Error("expected false for skipped event (terminal state)")
	}
}

func TestDedupKeyActive_EmptyKey(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	active, err := s.DedupKeyActive(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if active {
		t.Error("expected false for empty dedup key")
	}
}

func TestCreateWithDedupEnforcement(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	ev1 := &Event{
		DedupKey: "unique:key:1",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev1); err != nil {
		t.Fatal(err)
	}

	// Second event with same dedup key should be rejected
	ev2 := &Event{
		DedupKey: "unique:key:1",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	err := s.Create(ctx, ev2)
	if err == nil {
		t.Fatal("expected ErrDuplicateDedup for active dedup key")
	}
	if err != ErrDuplicateDedup {
		t.Errorf("error = %v, want ErrDuplicateDedup", err)
	}
}

func TestCreateWithDedupAfterCompletion(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	ev1 := &Event{
		DedupKey: "retry:key:1",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev1); err != nil {
		t.Fatal(err)
	}

	// Complete the first event
	s.SetMatched(ctx, ev1.ID, "w")
	s.SetDispatched(ctx, ev1.ID, "t")
	s.SetCompleted(ctx, ev1.ID)

	// Now a new event with the same dedup key should succeed
	ev2 := &Event{
		DedupKey: "retry:key:1",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev2); err != nil {
		t.Errorf("Create() after completion should succeed, got error: %v", err)
	}
	if ev2.ID == "" {
		t.Error("expected new event to have an ID")
	}
	if ev2.ID == ev1.ID {
		t.Error("new event should have a different ID")
	}
}

func TestCreateWithDedupAfterFailure(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	ev1 := &Event{
		DedupKey: "retry:key:2",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev1); err != nil {
		t.Fatal(err)
	}
	s.SetFailed(ctx, ev1.ID)

	// After failure, same dedup key should be allowed
	ev2 := &Event{
		DedupKey: "retry:key:2",
		Source:   "cron",
		Type:     "tick",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	if err := s.Create(ctx, ev2); err != nil {
		t.Errorf("Create() after failure should succeed, got error: %v", err)
	}
}

func TestCreateWithoutDedupKey(t *testing.T) {
	s := testDedupStore(t)
	ctx := context.Background()

	// Events without dedup keys should always be allowed
	for i := 0; i < 5; i++ {
		ev := &Event{
			Source: "github",
			Type:   "push",
			Attrs:  Attrs{},
			Raw:    json.RawMessage("{}"),
		}
		if err := s.Create(ctx, ev); err != nil {
			t.Fatalf("Create() %d without dedup key should succeed: %v", i+1, err)
		}
	}
}
