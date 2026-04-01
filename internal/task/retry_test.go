package task

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/store"
)

func testRetryStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
}

func TestRetryOrFail_Retries(t *testing.T) {
	s := testRetryStore(t)
	ctx := context.Background()

	task, err := s.Create(ctx, "worker-1", "do something")
	if err != nil {
		t.Fatal(err)
	}

	// First retry attempt — attempts goes from 0 to 1, max_retries=3 default
	retried, err := s.RetryOrFail(ctx, task.ID, "transient error")
	if err != nil {
		t.Fatalf("RetryOrFail() error = %v", err)
	}
	if !retried {
		t.Error("expected task to be retried (attempts=1 < max_retries=3)")
	}

	got, err := s.Get(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != StatePending {
		t.Errorf("State = %q, want %q", got.State, StatePending)
	}
	if got.Attempts != 1 {
		t.Errorf("Attempts = %d, want 1", got.Attempts)
	}
	if got.NextRetryAt == nil {
		t.Fatal("NextRetryAt should be set after retry")
	}
	// Backoff: 30s * 2^0 = 30s
	expectedDelay := RetryBaseDelay
	minRetry := time.Now().Add(expectedDelay - 5*time.Second)
	if got.NextRetryAt.Before(minRetry) {
		t.Errorf("NextRetryAt too early: %v", got.NextRetryAt)
	}
}

func TestRetryOrFail_DeadLetter(t *testing.T) {
	s := testRetryStore(t)
	ctx := context.Background()

	task, err := s.Create(ctx, "worker-1", "failing task")
	if err != nil {
		t.Fatal(err)
	}

	// Retry until max_retries is reached (default=3)
	for i := 0; i < DefaultMaxRetries-1; i++ {
		retried, err := s.RetryOrFail(ctx, task.ID, "transient error")
		if err != nil {
			t.Fatalf("retry %d error: %v", i+1, err)
		}
		if !retried {
			t.Errorf("retry %d should have succeeded", i+1)
		}
	}

	// This attempt should dead-letter (attempts reaches max_retries)
	retried, err := s.RetryOrFail(ctx, task.ID, "final error")
	if err != nil {
		t.Fatalf("RetryOrFail() dead-letter error = %v", err)
	}
	if retried {
		t.Error("expected task to be dead-lettered, not retried")
	}

	got, err := s.Get(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != StateFailed {
		t.Errorf("State = %q, want %q", got.State, StateFailed)
	}
	if got.ErrorMsg != "final error" {
		t.Errorf("ErrorMsg = %q, want %q", got.ErrorMsg, "final error")
	}
	if got.Attempts != DefaultMaxRetries {
		t.Errorf("Attempts = %d, want %d", got.Attempts, DefaultMaxRetries)
	}
}

func TestRetryOrFail_ExponentialBackoff(t *testing.T) {
	s := testRetryStore(t)
	ctx := context.Background()

	task, err := s.Create(ctx, "w", "task")
	if err != nil {
		t.Fatal(err)
	}

	// Set max_retries high enough to test multiple backoffs
	s.db.ExecContext(ctx,
		"UPDATE tasks SET max_retries = 10 WHERE id = ?", task.ID)

	var lastRetry time.Time
	for i := 0; i < 3; i++ {
		retried, err := s.RetryOrFail(ctx, task.ID, "err")
		if err != nil {
			t.Fatal(err)
		}
		if !retried {
			t.Fatalf("attempt %d: expected retry", i+1)
		}
		got, _ := s.Get(ctx, task.ID)
		if got.NextRetryAt == nil {
			t.Fatalf("attempt %d: NextRetryAt is nil", i+1)
		}
		if i > 0 && !got.NextRetryAt.After(lastRetry) {
			t.Errorf("attempt %d: NextRetryAt (%v) should be after previous (%v)",
				i+1, got.NextRetryAt, lastRetry)
		}
		lastRetry = *got.NextRetryAt
	}
}

func TestReadyForRetry(t *testing.T) {
	s := testRetryStore(t)
	ctx := context.Background()

	task, _ := s.Create(ctx, "w", "task")

	// Set task as pending with next_retry_at in the past
	pastRetry := time.Now().Add(-1 * time.Minute).Unix()
	s.db.ExecContext(ctx,
		"UPDATE tasks SET state = 'pending', next_retry_at = ? WHERE id = ?",
		pastRetry, task.ID)

	ids, err := s.ReadyForRetry(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 {
		t.Fatalf("ReadyForRetry() returned %d tasks, want 1", len(ids))
	}
	if ids[0] != task.ID {
		t.Errorf("got ID %q, want %q", ids[0], task.ID)
	}
}

func TestReadyForRetry_SkipsFuture(t *testing.T) {
	s := testRetryStore(t)
	ctx := context.Background()

	task, _ := s.Create(ctx, "w", "task")

	// Set next_retry_at far in the future
	futureRetry := time.Now().Add(1 * time.Hour).Unix()
	s.db.ExecContext(ctx,
		"UPDATE tasks SET state = 'pending', next_retry_at = ? WHERE id = ?",
		futureRetry, task.ID)

	ids, err := s.ReadyForRetry(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 0 {
		t.Errorf("ReadyForRetry() returned %d tasks, want 0 (future retry)", len(ids))
	}
}

func TestReadyForRetry_SkipsNullNextRetry(t *testing.T) {
	s := testRetryStore(t)
	ctx := context.Background()

	// A normal pending task has next_retry_at = NULL (not a retry)
	s.Create(ctx, "w", "normal-task")

	ids, err := s.ReadyForRetry(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 0 {
		t.Errorf("ReadyForRetry() returned %d tasks, want 0 (null next_retry_at)", len(ids))
	}
}

func TestReadyForRetry_MultipleTasks(t *testing.T) {
	s := testRetryStore(t)
	ctx := context.Background()

	past := time.Now().Add(-1 * time.Minute).Unix()
	future := time.Now().Add(1 * time.Hour).Unix()

	t1, _ := s.Create(ctx, "w", "past-task")
	t2, _ := s.Create(ctx, "w", "future-task")
	t3, _ := s.Create(ctx, "w", "past-task-2")

	s.db.ExecContext(ctx,
		"UPDATE tasks SET state = 'pending', next_retry_at = ? WHERE id = ?",
		past, t1.ID)
	s.db.ExecContext(ctx,
		"UPDATE tasks SET state = 'pending', next_retry_at = ? WHERE id = ?",
		future, t2.ID)
	s.db.ExecContext(ctx,
		"UPDATE tasks SET state = 'pending', next_retry_at = ? WHERE id = ?",
		past-60, t3.ID)

	ids, err := s.ReadyForRetry(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 {
		t.Fatalf("ReadyForRetry() returned %d tasks, want 2", len(ids))
	}
	// Should be ordered by next_retry_at — t3 (earlier) first, then t1
	if ids[0] != t3.ID {
		t.Errorf("first ID = %q, want %q (earlier retry)", ids[0], t3.ID)
	}
	if ids[1] != t1.ID {
		t.Errorf("second ID = %q, want %q", ids[1], t1.ID)
	}
}

func TestRetryOrFail_NonexistentTask(t *testing.T) {
	s := testRetryStore(t)
	ctx := context.Background()

	_, err := s.RetryOrFail(ctx, "nonexistent-id", "some error")
	if err == nil {
		t.Fatal("expected error for nonexistent task")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want containing 'not found'", err)
	}
}

func TestReadyForRetry_SkipsNonPending(t *testing.T) {
	s := testRetryStore(t)
	ctx := context.Background()

	task, _ := s.Create(ctx, "w", "completed-task")
	past := time.Now().Add(-1 * time.Minute).Unix()

	// Mark as dispatched with a past next_retry_at — should NOT be returned
	s.db.ExecContext(ctx,
		"UPDATE tasks SET state = 'dispatched', next_retry_at = ? WHERE id = ?",
		past, task.ID)

	ids, err := s.ReadyForRetry(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 0 {
		t.Errorf("ReadyForRetry() returned %d tasks for dispatched state, want 0", len(ids))
	}
}
