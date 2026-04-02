package tasks

import (
	"context"
	"path/filepath"
	"testing"

	"mecha.im/internal/store"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
}

func TestCreateAndGet(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	task, err := s.Create(ctx, "worker-1", "hello world")
	if err != nil {
		t.Fatal(err)
	}
	if task.ID == "" {
		t.Error("expected non-empty ID")
	}
	if task.State != StatePending {
		t.Errorf("state = %q, want pending", task.State)
	}

	got, err := s.Get(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Prompt != "hello world" {
		t.Errorf("prompt = %q", got.Prompt)
	}
	if got.WorkerName != "worker-1" {
		t.Errorf("worker = %q", got.WorkerName)
	}
}

func TestGetNotFound(t *testing.T) {
	s := testStore(t)
	_, err := s.Get(context.Background(), "nonexistent")
	if err == nil {
		t.Error("expected error")
	}
}

func TestFullLifecycle(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()

	task, err := s.Create(ctx, "w", "prompt")
	if err != nil {
		t.Fatal(err)
	}

	if err := s.SetDispatched(ctx, task.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, task.ID)
	if got.State != StateDispatched {
		t.Errorf("state = %q after dispatch", got.State)
	}
	if got.DispatchedAt == nil {
		t.Error("dispatched_at should be set")
	}

	if err := s.Complete(ctx, task.ID, `{"output":"done"}`); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Get(ctx, task.ID)
	if got.State != StateCompleted {
		t.Errorf("state = %q after complete", got.State)
	}
	if got.Result != `{"output":"done"}` {
		t.Errorf("result = %q", got.Result)
	}
	if got.CompletedAt == nil {
		t.Error("completed_at should be set")
	}
}

func TestFailFromPending(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	task, _ := s.Create(ctx, "w", "prompt")
	if err := s.Fail(ctx, task.ID, "worker offline"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, task.ID)
	if got.State != StateFailed {
		t.Errorf("state = %q", got.State)
	}
	if got.ErrorMsg != "worker offline" {
		t.Errorf("error = %q", got.ErrorMsg)
	}
}

func TestFailFromDispatched(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	task, _ := s.Create(ctx, "w", "prompt")
	s.SetDispatched(ctx, task.ID)
	if err := s.Fail(ctx, task.ID, "timeout"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, task.ID)
	if got.State != StateFailed {
		t.Errorf("state = %q", got.State)
	}
}

func TestInvalidStateTransition(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	task, _ := s.Create(ctx, "w", "prompt")
	// Can't complete a pending task (must be dispatched first)
	if err := s.Complete(ctx, task.ID, "result"); err == nil {
		t.Error("expected error for pending→completed")
	}
	// Can't dispatch a completed task
	s.SetDispatched(ctx, task.ID)
	s.Complete(ctx, task.ID, "result")
	if err := s.SetDispatched(ctx, task.ID); err == nil {
		t.Error("expected error for completed→dispatched")
	}
}

func TestFailFromCompleted(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	task, _ := s.Create(ctx, "w", "prompt")
	s.SetDispatched(ctx, task.ID)
	s.Complete(ctx, task.ID, "done")
	if err := s.Fail(ctx, task.ID, "too late"); err == nil {
		t.Error("expected error for completed→failed")
	}
}

func TestDoubleDispatch(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	task, _ := s.Create(ctx, "w", "prompt")
	s.SetDispatched(ctx, task.ID)
	if err := s.SetDispatched(ctx, task.ID); err == nil {
		t.Error("expected error for dispatched→dispatched")
	}
}

func TestFailNonexistent(t *testing.T) {
	s := testStore(t)
	if err := s.Fail(context.Background(), "ghost", "err"); err == nil {
		t.Error("expected error for nonexistent task")
	}
}

func TestListAll(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	s.Create(ctx, "w1", "p1")
	s.Create(ctx, "w2", "p2")
	s.Create(ctx, "w3", "p3")

	tasks, err := s.List(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 3 {
		t.Errorf("got %d tasks", len(tasks))
	}
}

func TestListByState(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	t1, _ := s.Create(ctx, "w", "p1")
	s.Create(ctx, "w", "p2")
	s.SetDispatched(ctx, t1.ID)

	dispatched, _ := s.List(ctx, "dispatched")
	if len(dispatched) != 1 {
		t.Errorf("dispatched = %d, want 1", len(dispatched))
	}
	pending, _ := s.List(ctx, "pending")
	if len(pending) != 1 {
		t.Errorf("pending = %d, want 1", len(pending))
	}
}

func TestPendingRecovery(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	t1, _ := s.Create(ctx, "w", "p1")
	t2, _ := s.Create(ctx, "w", "p2")
	t3, _ := s.Create(ctx, "w", "p3")
	s.SetDispatched(ctx, t2.ID)
	s.SetDispatched(ctx, t3.ID)
	s.Complete(ctx, t3.ID, "done")

	ids, err := s.Pending(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// t1 (pending) + t2 (dispatched), not t3 (completed)
	if len(ids) != 2 {
		t.Errorf("pending ids = %d, want 2", len(ids))
	}
	found := map[string]bool{}
	for _, id := range ids {
		found[id] = true
	}
	if !found[t1.ID] || !found[t2.ID] {
		t.Errorf("expected t1 and t2, got %v", ids)
	}
}
