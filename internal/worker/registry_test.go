package worker

import (
	"path/filepath"
	"testing"

	"mecha.im/internal/store"
)

func testRegistry(t *testing.T) *Registry {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	r, err := NewRegistry(db)
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
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r1, err := NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := r1.Add(testWorker("persist")); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db2, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	r2, err := NewRegistry(db2)
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

func TestRegistryListSorted(t *testing.T) {
	r := testRegistry(t)
	for _, name := range []string{"charlie", "alpha", "bravo"} {
		if err := r.Add(testWorker(name)); err != nil {
			t.Fatal(err)
		}
	}
	entries := r.List()
	if len(entries) != 3 {
		t.Fatalf("got %d entries, want 3", len(entries))
	}
	want := []string{"alpha", "bravo", "charlie"}
	for i, e := range entries {
		if e.Worker.Name != want[i] {
			t.Errorf("entries[%d].Name = %q, want %q", i, e.Worker.Name, want[i])
		}
	}
}

func TestRegistryGetReturnsCopy(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	e, _ := r.Get("w")
	e.State = StateOnline // mutate the copy
	e2, _ := r.Get("w")
	if e2.State != StateOffline {
		t.Error("Get returned live reference, not a copy")
	}
}

func TestSetErrorRedactsSecrets(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.Start("w"); err != nil {
		t.Fatal(err)
	}
	if err := r.SetError("w", "auth failed: ghp_abc123XYZ token expired"); err != nil {
		t.Fatal(err)
	}
	e, _ := r.Get("w")
	if e.Error == "auth failed: ghp_abc123XYZ token expired" {
		t.Error("secret not redacted in error message")
	}
}

func TestRegistrySetRuntime(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.SetRuntime("w", "container-abc", "http://127.0.0.1:32768"); err != nil {
		t.Fatal(err)
	}
	e, _ := r.Get("w")
	if e.State != StateOnline {
		t.Errorf("state = %q, want online", e.State)
	}
	if e.ContainerID != "container-abc" {
		t.Errorf("containerID = %q", e.ContainerID)
	}
	if e.RuntimeEndpoint != "http://127.0.0.1:32768" {
		t.Errorf("endpoint = %q", e.RuntimeEndpoint)
	}
	if e.StartedAt == nil {
		t.Error("startedAt should be set")
	}
}

func TestRegistrySetRuntimeNotFound(t *testing.T) {
	r := testRegistry(t)
	if err := r.SetRuntime("ghost", "c", "e"); err == nil {
		t.Error("expected not found error")
	}
}

func TestRegistryStopRuntime(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.SetRuntime("w", "container-abc", "http://127.0.0.1:32768"); err != nil {
		t.Fatal(err)
	}
	if err := r.StopRuntime("w"); err != nil {
		t.Fatal(err)
	}
	e, _ := r.Get("w")
	if e.State != StateOffline {
		t.Errorf("state = %q, want offline", e.State)
	}
	if e.RuntimeEndpoint != "" {
		t.Errorf("endpoint should be cleared, got %q", e.RuntimeEndpoint)
	}
	if e.StartedAt != nil {
		t.Error("startedAt should be nil")
	}
	// ContainerID preserved for remove
	if e.ContainerID != "container-abc" {
		t.Errorf("containerID should be preserved, got %q", e.ContainerID)
	}
}

func TestRegistryClearRuntime(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.SetRuntime("w", "container-abc", "http://127.0.0.1:32768"); err != nil {
		t.Fatal(err)
	}
	if err := r.ClearRuntime("w"); err != nil {
		t.Fatal(err)
	}
	e, _ := r.Get("w")
	if e.State != StateOffline {
		t.Errorf("state = %q", e.State)
	}
	if e.ContainerID != "" {
		t.Errorf("containerID should be cleared, got %q", e.ContainerID)
	}
	if e.RuntimeEndpoint != "" {
		t.Errorf("endpoint should be cleared, got %q", e.RuntimeEndpoint)
	}
}

func TestRegistryRuntimePersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r1, err := NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := r1.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r1.SetRuntime("w", "cid-123", "http://127.0.0.1:9999"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db2, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	r2, err := NewRegistry(db2)
	if err != nil {
		t.Fatal(err)
	}
	e, ok := r2.Get("w")
	if !ok {
		t.Fatal("worker not found after reload")
	}
	if e.ContainerID != "cid-123" {
		t.Errorf("containerID = %q after reload", e.ContainerID)
	}
	if e.RuntimeEndpoint != "http://127.0.0.1:9999" {
		t.Errorf("endpoint = %q after reload", e.RuntimeEndpoint)
	}
}
