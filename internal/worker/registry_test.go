package worker

import (
	"path/filepath"
	"testing"
)

func testRegistry(t *testing.T) *Registry {
	t.Helper()
	path := filepath.Join(t.TempDir(), "registry.json")
	r, err := NewRegistry(path)
	if err != nil {
		t.Fatalf("new registry: %v", err)
	}
	return r
}

func testWorker(name string) *Worker {
	return &Worker{Name: name, Endpoint: "http://localhost:8080"}
}

func TestRegistryAddAndList(t *testing.T) {
	r := testRegistry(t)
	w := testWorker("alpha")
	if err := r.Add(w); err != nil {
		t.Fatalf("add: %v", err)
	}
	entries := r.List()
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	if entries[0].State != StateOffline {
		t.Errorf("state = %q, want offline", entries[0].State)
	}
}

func TestRegistryAddDuplicate(t *testing.T) {
	r := testRegistry(t)
	w := testWorker("alpha")
	if err := r.Add(w); err != nil {
		t.Fatal(err)
	}
	if err := r.Add(w); err == nil {
		t.Error("expected duplicate error")
	}
}

func TestRegistryStartStop(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.Start("w"); err != nil {
		t.Fatalf("start: %v", err)
	}
	e, ok := r.Get("w")
	if !ok {
		t.Fatal("worker not found")
	}
	if e.State != StateOnline {
		t.Errorf("state after start = %q", e.State)
	}
	if e.StartedAt == nil {
		t.Error("started_at should be set")
	}
	if err := r.Stop("w"); err != nil {
		t.Fatalf("stop: %v", err)
	}
	e, _ = r.Get("w")
	if e.State != StateOffline {
		t.Errorf("state after stop = %q", e.State)
	}
}

func TestRegistryRemoveRequiresOffline(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.Start("w"); err != nil {
		t.Fatal(err)
	}
	if err := r.Remove("w"); err == nil {
		t.Error("expected error removing online worker")
	}
}

func TestRegistryStartRequiresOffline(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.Start("w"); err != nil {
		t.Fatal(err)
	}
	if err := r.Start("w"); err == nil {
		t.Error("expected error starting online worker")
	}
}

func TestRegistryNotFound(t *testing.T) {
	r := testRegistry(t)
	tests := []struct {
		name string
		fn   func() error
	}{
		{"start", func() error { return r.Start("ghost") }},
		{"stop", func() error { return r.Stop("ghost") }},
		{"remove", func() error { return r.Remove("ghost") }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.fn(); err == nil {
				t.Error("expected not found error")
			}
		})
	}
}

func TestRegistryPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.json")
	r1, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := r1.Add(testWorker("persist")); err != nil {
		t.Fatal(err)
	}
	r2, err := NewRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := r2.Get("persist"); !ok {
		t.Error("worker not found after reload")
	}
}

func TestRegistrySetError(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.Start("w"); err != nil {
		t.Fatal(err)
	}
	if err := r.SetError("w", "connection refused"); err != nil {
		t.Fatal(err)
	}
	e, _ := r.Get("w")
	if e.State != StateError {
		t.Errorf("state = %q, want error", e.State)
	}
	if err := r.Stop("w"); err != nil {
		t.Fatalf("stop from error state should work: %v", err)
	}
}
