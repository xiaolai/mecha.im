package event

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"mecha.im/internal/store"
)

func testGapStore(t *testing.T) *Store {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
}

// --- 1. Received() ---

func TestReceivedMultipleEvents(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	// Create three events in received state
	ev1 := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	ev2 := &Event{Source: "slack", Type: "message", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	ev3 := &Event{Source: "telegram", Type: "message", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	s.Create(ctx, ev1)
	s.Create(ctx, ev2)
	s.Create(ctx, ev3)

	ids, err := s.Received(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 3 {
		t.Fatalf("expected 3 received events, got %d", len(ids))
	}
	// Verify order: should be by created_at
	if ids[0] != ev1.ID || ids[1] != ev2.ID || ids[2] != ev3.ID {
		t.Errorf("unexpected order: %v", ids)
	}
}

func TestReceivedExcludesNonReceived(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	ev1 := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	ev2 := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	ev3 := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	ev4 := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	s.Create(ctx, ev1)
	s.Create(ctx, ev2)
	s.Create(ctx, ev3)
	s.Create(ctx, ev4)

	// Move some events out of received state
	s.SetMatched(ctx, ev1.ID, "w1")
	s.SetSkipped(ctx, ev2.ID)
	s.SetFailed(ctx, ev3.ID)

	ids, err := s.Received(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Only ev4 should be in received
	if len(ids) != 1 {
		t.Fatalf("expected 1 received event, got %d", len(ids))
	}
	if ids[0] != ev4.ID {
		t.Errorf("expected %q, got %q", ev4.ID, ids[0])
	}
}

func TestReceivedEmpty(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	ids, err := s.Received(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 0 {
		t.Errorf("expected 0 received events, got %d", len(ids))
	}
}

// --- 2. genID ---

func TestGenID(t *testing.T) {
	id1, err := genID()
	if err != nil {
		t.Fatal(err)
	}
	if len(id1) != 32 {
		t.Errorf("expected 32 char hex string, got %d chars: %q", len(id1), id1)
	}

	id2, err := genID()
	if err != nil {
		t.Fatal(err)
	}
	if id1 == id2 {
		t.Error("expected different IDs from two calls")
	}

	// Validate hex
	for _, c := range id1 {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("non-hex character in ID: %c", c)
		}
	}
}

// --- 3. checkRows error path ---

func TestSetFailedNonexistentEvent(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	err := s.SetFailed(ctx, "nonexistent-event-id")
	if err == nil {
		t.Error("expected error when failing nonexistent event")
	}
}

// --- 4. scanEvent — null/empty attrs ---

func TestScanEventNullAttrs(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	// Insert directly with "null" attrs to test the branch
	now := 1000
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO events (id, delivery_id, dedup_key, source, type, actor, subject,
		 attrs, raw, state, worker_name, task_id, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		"null-attrs-id", "", "", "test", "test.event", "", "",
		"null", "", "received", "", "", now, now,
	)
	if err != nil {
		t.Fatal(err)
	}

	ev, err := s.Get(ctx, "null-attrs-id")
	if err != nil {
		t.Fatal(err)
	}
	if ev.Attrs == nil {
		t.Error("expected non-nil Attrs even with null in DB")
	}
}

func TestScanEventEmptyAttrs(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	// Insert with empty attrs string
	now := 1000
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO events (id, delivery_id, dedup_key, source, type, actor, subject,
		 attrs, raw, state, worker_name, task_id, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		"empty-attrs-id", "", "", "test", "test.event", "", "",
		"", "", "received", "", "", now, now,
	)
	if err != nil {
		t.Fatal(err)
	}

	ev, err := s.Get(ctx, "empty-attrs-id")
	if err != nil {
		t.Fatal(err)
	}
	if ev.Attrs == nil {
		t.Error("expected non-nil Attrs even with empty string in DB")
	}
}

// --- 5. DeliveryExists — empty delivery ID ---

func TestDeliveryExistsEmptyID(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	exists, err := s.DeliveryExists(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Error("empty delivery ID should return false")
	}
}

// --- 6. List — with and without state filter ---

func TestListWithStateFilter(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	ev1 := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	ev2 := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	ev3 := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	s.Create(ctx, ev1)
	s.Create(ctx, ev2)
	s.Create(ctx, ev3)
	s.SetSkipped(ctx, ev2.ID)
	s.SetFailed(ctx, ev3.ID)

	// No filter
	all, err := s.List(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Errorf("expected 3, got %d", len(all))
	}

	// Filter by received
	received, err := s.List(ctx, "received")
	if err != nil {
		t.Fatal(err)
	}
	if len(received) != 1 {
		t.Errorf("expected 1 received, got %d", len(received))
	}

	// Filter by skipped
	skipped, err := s.List(ctx, "skipped")
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 1 {
		t.Errorf("expected 1 skipped, got %d", len(skipped))
	}

	// Filter by failed
	failed, err := s.List(ctx, "failed")
	if err != nil {
		t.Fatal(err)
	}
	if len(failed) != 1 {
		t.Errorf("expected 1 failed, got %d", len(failed))
	}

	// Filter by nonexistent state
	none, err := s.List(ctx, "imaginary")
	if err != nil {
		t.Fatal(err)
	}
	if len(none) != 0 {
		t.Errorf("expected 0, got %d", len(none))
	}
}

// --- 7. UpdateAttrs — nonexistent event ---

func TestUpdateAttrsNonexistent(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	err := s.UpdateAttrs(ctx, "ghost-event-id", Attrs{"key": "val"})
	if err == nil {
		t.Error("expected error when updating attrs of nonexistent event")
	}
}

// --- 8. SetFailed on already-completed event ---

func TestSetFailedOnCompletedEvent(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	ev := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	s.Create(ctx, ev)
	s.SetMatched(ctx, ev.ID, "w")
	s.SetDispatched(ctx, ev.ID, "t")
	s.SetCompleted(ctx, ev.ID)

	// Attempting to fail a completed event should error
	err := s.SetFailed(ctx, ev.ID)
	if err == nil {
		t.Error("expected error when failing a completed event")
	}
}

func TestSetFailedOnSkippedEvent(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	ev := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	s.Create(ctx, ev)
	s.SetSkipped(ctx, ev.ID)

	// Attempting to fail a skipped event should error
	err := s.SetFailed(ctx, ev.ID)
	if err == nil {
		t.Error("expected error when failing a skipped event")
	}
}

// --- Additional: SetMatched on wrong state ---

func TestSetMatchedWrongState(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	ev := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	s.Create(ctx, ev)
	s.SetMatched(ctx, ev.ID, "w")
	s.SetDispatched(ctx, ev.ID, "t")

	// Try to match again after dispatch
	err := s.SetMatched(ctx, ev.ID, "w2")
	if err == nil {
		t.Error("expected error when matching a dispatched event")
	}
}

// --- Additional: SetCompleted on wrong state ---

func TestSetCompletedWrongState(t *testing.T) {
	s := testGapStore(t)
	ctx := context.Background()

	ev := &Event{Source: "github", Type: "push", Attrs: Attrs{}, Raw: json.RawMessage("{}")}
	s.Create(ctx, ev)

	// Try to complete a received event (should be dispatched first)
	err := s.SetCompleted(ctx, ev.ID)
	if err == nil {
		t.Error("expected error when completing a received event")
	}
}
