package serve

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"mecha.im/internal/store"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
)

func TestStartAndShutdown(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := worker.NewRegistry(db)
	tasks := task.NewStore(db)

	srv := New(Config{
		Registry: reg,
		Tasks:    tasks,
		Addr:     "127.0.0.1:0",
	})

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()

	// Wait for server to start
	time.Sleep(500 * time.Millisecond)

	// Cancel and verify clean shutdown
	cancel()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("Start returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown timed out")
	}
}

func TestStartBadAddr(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, _ := store.Open(path)
	defer db.Close()

	reg, _ := worker.NewRegistry(db)
	tasks := task.NewStore(db)

	srv := New(Config{
		Registry: reg,
		Tasks:    tasks,
		Addr:     "999.999.999.999:99999", // invalid address
	})

	err := srv.Start(context.Background())
	if err == nil {
		t.Error("expected error for bad address")
	}
}

func TestStartWithRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, _ := store.Open(path)
	defer db.Close()

	reg, _ := worker.NewRegistry(db)
	ts := task.NewStore(db)

	// Create pending tasks before server starts
	ctx := context.Background()
	t1, _ := ts.Create(ctx, "w1", "p1")
	t2, _ := ts.Create(ctx, "w2", "p2")

	srv := New(Config{
		Registry: reg,
		Tasks:    ts,
		Addr:     "127.0.0.1:0",
	})

	srvCtx, cancel := context.WithCancel(ctx)
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(srvCtx) }()

	// Wait for dispatch loop to process recovered tasks (workers don't exist → failed)
	time.Sleep(1 * time.Second)

	// Tasks should have been recovered and attempted (failed because no workers)
	got1, _ := ts.Get(ctx, t1.ID)
	got2, _ := ts.Get(ctx, t2.ID)
	if got1.State != task.StateFailed {
		t.Errorf("t1 state = %q, want failed (recovered)", got1.State)
	}
	if got2.State != task.StateFailed {
		t.Errorf("t2 state = %q, want failed (recovered)", got2.State)
	}

	cancel()
	<-errCh
}
