package event

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"mecha.im/internal/store"
)

func testMaxStore(t *testing.T) *Store {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
}

// --- Create: json.Marshal error for attrs ---

func TestCreateUnmarshalableAttrs(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	// math.Inf and similar aren't valid JSON — use a channel which can't be marshaled
	ev := &Event{
		Source: "test",
		Type:   "test.event",
		Attrs:  Attrs{"bad": make(chan int)},
		Raw:    json.RawMessage("{}"),
	}
	err := s.Create(ctx, ev)
	if err == nil {
		t.Error("expected error when marshaling unmarshalable attrs")
	}
}

// --- transition error: ExecContext with closed DB ---

func TestTransitionClosedDB(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	ev := &Event{Source: "test", Type: "test.event", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}

	// Close the DB to trigger ExecContext error
	s.db.Close()

	err := s.SetMatched(ctx, ev.ID, "worker1")
	if err == nil {
		t.Error("expected error from closed DB in transition")
	}
}

// --- transitionWithExtra error: ExecContext with closed DB ---

func TestTransitionWithExtraClosedDB(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	ev := &Event{Source: "test", Type: "test.event", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMatched(ctx, ev.ID, "w1"); err != nil {
		t.Fatal(err)
	}

	s.db.Close()

	err := s.SetDispatched(ctx, ev.ID, "task1")
	if err == nil {
		t.Error("expected error from closed DB in transitionWithExtra")
	}
}

// --- SetFailed error: ExecContext with closed DB ---

func TestSetFailedClosedDB(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	ev := &Event{Source: "test", Type: "test.event", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}

	s.db.Close()

	err := s.SetFailed(ctx, ev.ID)
	if err == nil {
		t.Error("expected error from closed DB in SetFailed")
	}
}

// --- UpdateAttrs error: ExecContext with closed DB ---

func TestUpdateAttrsClosedDB(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	ev := &Event{Source: "test", Type: "test.event", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}

	s.db.Close()

	err := s.UpdateAttrs(ctx, ev.ID, Attrs{"key": "val"})
	if err == nil {
		t.Error("expected error from closed DB in UpdateAttrs")
	}
}

// --- DeliveryExists error: QueryRowContext with closed DB ---

func TestDeliveryExistsClosedDB(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.DeliveryExists(ctx, "some-delivery")
	if err == nil {
		t.Error("expected error from closed DB in DeliveryExists")
	}
}

// --- List error: QueryContext with closed DB ---

func TestListClosedDB(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.List(ctx, "")
	if err == nil {
		t.Error("expected error from closed DB in List")
	}
}

// --- Received error: QueryContext with closed DB ---

func TestReceivedClosedDB(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.Received(ctx)
	if err == nil {
		t.Error("expected error from closed DB in Received")
	}
}

// --- DedupKeyActive error: QueryRowContext with closed DB ---

func TestDedupKeyActiveClosedDB(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.DedupKeyActive(ctx, "some-key")
	if err == nil {
		t.Error("expected error from closed DB in DedupKeyActive")
	}
}

// --- Create: dedup check error path ---

func TestCreateDedupCheckError(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	s.db.Close()

	ev := &Event{
		Source:   "test",
		Type:     "test.event",
		DedupKey: "somekey",
		Attrs:    Attrs{},
		Raw:      json.RawMessage("{}"),
	}
	err := s.Create(ctx, ev)
	if err == nil {
		t.Error("expected error when dedup check hits closed DB")
	}
}

// --- Create: insert error path (closed DB after genID) ---

func TestCreateInsertError(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	// Create an event — then put the DB into query_only mode
	if _, err := s.db.Exec("PRAGMA query_only = ON"); err != nil {
		t.Fatal(err)
	}

	ev := &Event{
		ID:     "pregenerated-id",
		Source: "test",
		Type:   "test.event",
		Attrs:  Attrs{},
		Raw:    json.RawMessage("{}"),
	}
	err := s.Create(ctx, ev)
	if err == nil {
		t.Error("expected error when inserting into read-only DB")
	}
}

// --- UpdateAttrs: unmarshalable attrs error ---

func TestUpdateAttrsUnmarshalableAttrs(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	ev := &Event{Source: "test", Type: "test.event", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	if err := s.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}

	err := s.UpdateAttrs(ctx, ev.ID, Attrs{"bad": make(chan int)})
	if err == nil {
		t.Error("expected error when marshaling unmarshalable attrs")
	}
}

// --- Get: event not found ---

func TestGetEventNotFound(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	_, err := s.Get(ctx, "nonexistent-id")
	if err == nil {
		t.Error("expected error for nonexistent event")
	}
}

// --- Get: closed DB error ---

func TestGetClosedDB(t *testing.T) {
	s := testMaxStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.Get(ctx, "any-id")
	if err == nil {
		t.Error("expected error from closed DB in Get")
	}
}
