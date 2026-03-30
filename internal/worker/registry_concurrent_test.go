package worker

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"mecha.im/internal/store"
)

func testDB(t *testing.T) *Registry {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	r, err := NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestRegistryConcurrentAddGet(t *testing.T) {
	r := testDB(t)

	const n = 20
	var wg sync.WaitGroup
	errs := make(chan error, n*2)

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			w := &Worker{Name: fmt.Sprintf("w-%d", id), Endpoint: "http://localhost:8080"}
			if err := r.Add(w); err != nil {
				errs <- err
			}
		}(i)
	}

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			_ = r.List()
			_, _ = r.Get(fmt.Sprintf("w-%d", id))
		}(i)
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("concurrent error: %v", err)
	}

	entries := r.List()
	if len(entries) != n {
		t.Errorf("got %d entries, want %d", len(entries), n)
	}
}

func TestRegistryConcurrentStateTransitions(t *testing.T) {
	r := testDB(t)

	const n = 10
	for i := 0; i < n; i++ {
		w := &Worker{Name: fmt.Sprintf("s-%d", i), Endpoint: "http://localhost:8080"}
		if err := r.Add(w); err != nil {
			t.Fatal(err)
		}
	}

	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			name := fmt.Sprintf("s-%d", id)
			_ = r.Start(name)
			_ = r.SetError(name, "test error")
			_ = r.Stop(name)
			_ = r.Start(name)
			_ = r.SetRuntime(name, "cid", "http://x")
			_ = r.StopRuntime(name)
			_ = r.ClearRuntime(name)
		}(i)
	}

	wg.Wait()

	entries := r.List()
	if len(entries) != n {
		t.Errorf("got %d entries, want %d", len(entries), n)
	}
	for _, e := range entries {
		switch e.State {
		case StateOffline, StateOnline, StateError:
		default:
			t.Errorf("worker %q has invalid state %q", e.Worker.Name, e.State)
		}
	}
}

func TestRegistryConcurrentListDuringMutation(t *testing.T) {
	r := testDB(t)

	done := make(chan struct{})
	var writerWg sync.WaitGroup

	go func() {
		for {
			select {
			case <-done:
				return
			default:
				entries := r.List()
				for _, e := range entries {
					if e.Worker == nil || e.Worker.Name == "" {
						t.Errorf("list returned entry with nil/empty worker")
					}
				}
			}
		}
	}()

	for i := 0; i < 20; i++ {
		writerWg.Add(1)
		go func(id int) {
			defer writerWg.Done()
			name := fmt.Sprintf("m-%d", id)
			w := &Worker{Name: name, Endpoint: "http://localhost:8080"}
			_ = r.Add(w)
		}(i)
	}

	writerWg.Wait()
	close(done)
}
