package tasks

import (
	"context"
	"path/filepath"
	"testing"

	"mecha.im/internal/store"
)

func maxTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
}

// --- SetDispatched: ExecContext error with closed DB ---

func TestSetDispatchedClosedDB(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	task, err := s.Create(ctx, "w", "prompt")
	if err != nil {
		t.Fatal(err)
	}

	s.db.Close()

	err = s.SetDispatched(ctx, task.ID)
	if err == nil {
		t.Error("expected error from closed DB in SetDispatched")
	}
}

// --- Complete: ExecContext error with closed DB ---

func TestCompleteClosedDB(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	task, err := s.Create(ctx, "w", "prompt")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetDispatched(ctx, task.ID); err != nil {
		t.Fatal(err)
	}

	s.db.Close()

	err = s.Complete(ctx, task.ID, "result")
	if err == nil {
		t.Error("expected error from closed DB in Complete")
	}
}

// --- Fail: ExecContext error with closed DB ---

func TestFailClosedDB(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	task, err := s.Create(ctx, "w", "prompt")
	if err != nil {
		t.Fatal(err)
	}

	s.db.Close()

	err = s.Fail(ctx, task.ID, "oops")
	if err == nil {
		t.Error("expected error from closed DB in Fail")
	}
}

// --- CreateWithEvent: ExecContext error with read-only DB ---

func TestCreateWithEventExecError(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	if _, err := s.db.Exec("PRAGMA query_only = ON"); err != nil {
		t.Fatal(err)
	}

	_, err := s.CreateWithEvent(ctx, "w", "prompt", "{}", "ev-1")
	if err == nil {
		t.Error("expected error when inserting into read-only DB")
	}
}

// --- List: QueryContext error with closed DB ---

func TestListClosedDB(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.List(ctx, "")
	if err == nil {
		t.Error("expected error from closed DB in List")
	}
}

// --- List: rows.Err() path ---
// This is hard to trigger with SQLite, but the List function does check it.
// We can at least verify the function works normally, exercising all branches.

func TestListWithMultipleStates(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	// Create tasks in various states
	t1, _ := s.Create(ctx, "w1", "prompt1")
	secondTask, _ := s.Create(ctx, "w2", "prompt2")
	s.SetDispatched(ctx, t1.ID)
	s.Complete(ctx, t1.ID, "done")
	s.Fail(ctx, secondTask.ID, "oops")

	// List all
	all, err := s.List(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Errorf("expected 2 tasks, got %d", len(all))
	}

	// List by state
	completed, err := s.List(ctx, "completed")
	if err != nil {
		t.Fatal(err)
	}
	if len(completed) != 1 {
		t.Errorf("expected 1 completed, got %d", len(completed))
	}
}

// --- Pending: QueryContext error with closed DB ---

func TestPendingClosedDB(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.Pending(ctx)
	if err == nil {
		t.Error("expected error from closed DB in Pending")
	}
}

// --- HasCompletedDedup: QueryRowContext error with closed DB ---

func TestHasCompletedDedupClosedDB(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.HasCompletedDedup(ctx, "somekey")
	if err == nil {
		t.Error("expected error from closed DB in HasCompletedDedup")
	}
}

// --- ReadyForRetry: QueryContext error with closed DB ---

func TestReadyForRetryClosedDB(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.ReadyForRetry(ctx)
	if err == nil {
		t.Error("expected error from closed DB in ReadyForRetry")
	}
}

// --- Get: error with closed DB ---

func TestGetClosedDB(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	s.db.Close()

	_, err := s.Get(ctx, "any-id")
	if err == nil {
		t.Error("expected error from closed DB in Get")
	}
}

// --- scanTask: not found branch ---

func TestGetNotFoundMax(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	_, err := s.Get(ctx, "nonexistent-id")
	if err == nil {
		t.Error("expected error for nonexistent task")
	}
}

// --- ReadyForRetry: normal path ---

func TestReadyForRetryNormal(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	// Create a task and use RetryOrFail to set next_retry_at
	task, err := s.Create(ctx, "w", "prompt")
	if err != nil {
		t.Fatal(err)
	}

	// RetryOrFail will set next_retry_at to future — should NOT appear in ReadyForRetry
	retried, err := s.RetryOrFail(ctx, task.ID, "err1")
	if err != nil {
		t.Fatal(err)
	}
	if !retried {
		t.Error("expected retry for first attempt")
	}

	ids, err := s.ReadyForRetry(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// The retry is in the future, so it shouldn't be ready
	if len(ids) != 0 {
		t.Errorf("expected 0 ready for retry, got %d", len(ids))
	}
}

// --- Pending: includes dispatched tasks ---

func TestPendingIncludesDispatched(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	t1, _ := s.Create(ctx, "w", "p1")
	_, _ = s.Create(ctx, "w", "p2")
	s.SetDispatched(ctx, t1.ID)

	ids, err := s.Pending(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 {
		t.Errorf("expected 2 pending (including dispatched), got %d", len(ids))
	}
}

// --- RetryOrFail: dead-letter after max retries ---

func TestRetryOrFailDeadLetter(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	task, err := s.Create(ctx, "w", "prompt")
	if err != nil {
		t.Fatal(err)
	}

	// Exhaust retries
	for i := 0; i < DefaultMaxRetries; i++ {
		retried, err := s.RetryOrFail(ctx, task.ID, "error")
		if err != nil {
			t.Fatalf("retry %d: %v", i, err)
		}
		if i < DefaultMaxRetries-1 {
			if !retried {
				t.Errorf("retry %d: expected retry", i)
			}
		} else {
			if retried {
				t.Error("final attempt should be dead-lettered")
			}
		}
	}

	// Verify task is now failed
	got, err := s.Get(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != StateFailed {
		t.Errorf("state = %s, want failed", got.State)
	}
}

// --- RetryOrFail: Get error ---

func TestRetryOrFailGetError(t *testing.T) {
	t.Parallel()
	s := maxTestStore(t)
	ctx := context.Background()

	_, err := s.RetryOrFail(ctx, "nonexistent", "err")
	if err == nil {
		t.Error("expected error for nonexistent task in RetryOrFail")
	}
}
