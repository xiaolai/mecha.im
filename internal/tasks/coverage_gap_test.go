package tasks

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"mecha.im/internal/store"
)

func gapTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
}

// --- 1. HasCompletedDedup() ---

func TestHasCompletedDedupEmptyKey(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	found, err := s.HasCompletedDedup(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Error("empty key should return false")
	}
}

func TestHasCompletedDedupNoMatch(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	ctx := context.Background()

	// Create a task with a dedup key but leave it pending
	_, err := s.CreateWithEvent(ctx, "w", "prompt", "{}", "ev-1")
	if err != nil {
		t.Fatal(err)
	}

	found, err := s.HasCompletedDedup(ctx, "ev-1:w")
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Error("pending task should not count as completed dedup")
	}
}

func TestHasCompletedDedupCompleted(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	ctx := context.Background()

	task, err := s.CreateWithEvent(ctx, "w", "prompt", "{}", "ev-2")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetDispatched(ctx, task.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Complete(ctx, task.ID, "done"); err != nil {
		t.Fatal(err)
	}

	found, err := s.HasCompletedDedup(ctx, "ev-2:w")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Error("completed task should return true for dedup check")
	}
}

func TestHasCompletedDedupFailed(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	ctx := context.Background()

	task, err := s.CreateWithEvent(ctx, "w", "prompt", "{}", "ev-3")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Fail(ctx, task.ID, "oops"); err != nil {
		t.Fatal(err)
	}

	found, err := s.HasCompletedDedup(ctx, "ev-3:w")
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Error("failed task should not count as completed dedup")
	}
}

// --- 2. SetDispatched/Complete/Fail error paths (nonexistent ID) ---

func TestSetDispatchedNonexistentID(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	err := s.SetDispatched(context.Background(), "nonexistent-id")
	if err == nil {
		t.Fatal("expected error for nonexistent ID")
	}
	if !strings.Contains(err.Error(), "not found or invalid state") {
		t.Errorf("error = %q", err)
	}
}

func TestCompleteNonexistentID(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	err := s.Complete(context.Background(), "nonexistent-id", "result")
	if err == nil {
		t.Fatal("expected error for nonexistent ID")
	}
	if !strings.Contains(err.Error(), "not found or invalid state") {
		t.Errorf("error = %q", err)
	}
}

func TestFailNonexistentIDGap(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	err := s.Fail(context.Background(), "nonexistent-id", "err")
	if err == nil {
		t.Fatal("expected error for nonexistent ID")
	}
	if !strings.Contains(err.Error(), "not found or invalid state") {
		t.Errorf("error = %q", err)
	}
}

// --- 3. CreateWithEvent dedup_key construction ---

func TestCreateWithEventDedupKey(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	ctx := context.Background()

	// With eventID set, dedup_key = eventID + ":" + workerName
	task, err := s.CreateWithEvent(ctx, "my-worker", "prompt", "{}", "evt-123")
	if err != nil {
		t.Fatal(err)
	}
	if task.DedupKey != "evt-123:my-worker" {
		t.Errorf("DedupKey = %q, want %q", task.DedupKey, "evt-123:my-worker")
	}
	if task.EventID != "evt-123" {
		t.Errorf("EventID = %q", task.EventID)
	}

	// Verify persisted value
	got, err := s.Get(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.DedupKey != "evt-123:my-worker" {
		t.Errorf("persisted DedupKey = %q", got.DedupKey)
	}
}

func TestCreateWithEventEmptyEventID(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	ctx := context.Background()

	// With empty eventID, dedup_key should be empty
	task, err := s.CreateWithEvent(ctx, "my-worker", "prompt", "{}", "")
	if err != nil {
		t.Fatal(err)
	}
	if task.DedupKey != "" {
		t.Errorf("DedupKey = %q, want empty", task.DedupKey)
	}
	if task.EventID != "" {
		t.Errorf("EventID = %q, want empty", task.EventID)
	}
}

func TestCreateWithEventContext(t *testing.T) {
	t.Parallel()
	s := gapTestStore(t)
	ctx := context.Background()

	task, err := s.CreateWithEvent(ctx, "w", "prompt", `{"key":"val"}`, "ev-5")
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Context != `{"key":"val"}` {
		t.Errorf("Context = %q", got.Context)
	}
}
