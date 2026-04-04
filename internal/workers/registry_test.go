package workers

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

func TestRecoverFromError(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.Start("w"); err != nil {
		t.Fatal(err)
	}
	if err := r.SetError("w", "was unhealthy"); err != nil {
		t.Fatal(err)
	}
	if err := r.Recover("w"); err != nil {
		t.Fatal(err)
	}
	e, _ := r.Get("w")
	if e.State != StateOnline {
		t.Errorf("state = %q, want online", e.State)
	}
	if e.Error != "" {
		t.Errorf("error = %q, want empty", e.Error)
	}
}

func TestRecoverRequiresErrorState(t *testing.T) {
	r := testRegistry(t)
	if err := r.Add(testWorker("w")); err != nil {
		t.Fatal(err)
	}
	if err := r.Start("w"); err != nil {
		t.Fatal(err)
	}
	if err := r.Recover("w"); err == nil {
		t.Error("Recover from online should fail")
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

func TestRegistryRemoveSuccess(t *testing.T) {
	r := testRegistry(t)
	r.Add(testWorker("w"))
	if err := r.Remove("w"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, ok := r.Get("w"); ok {
		t.Error("worker should be gone after remove")
	}
	if len(r.List()) != 0 {
		t.Error("list should be empty")
	}
}

func TestRegistryRemoveNotFound(t *testing.T) {
	r := testRegistry(t)
	if err := r.Remove("ghost"); err == nil {
		t.Error("expected not found error")
	}
}

func TestRegistryRemoveOnline(t *testing.T) {
	r := testRegistry(t)
	r.Add(testWorker("w"))
	r.Start("w")
	if err := r.Remove("w"); err == nil {
		t.Error("expected error removing online worker")
	}
}

func TestRegistryRemoveError(t *testing.T) {
	r := testRegistry(t)
	r.Add(testWorker("w"))
	r.Start("w")
	r.SetError("w", "fail")
	if err := r.Remove("w"); err == nil {
		t.Error("expected error removing error-state worker")
	}
}

func TestRegistryStopOffline(t *testing.T) {
	r := testRegistry(t)
	r.Add(testWorker("w"))
	if err := r.Stop("w"); err == nil {
		t.Error("expected error stopping offline worker")
	}
}

func TestRegistryAddPersistError(t *testing.T) {
	r := testRegistry(t)
	w1 := testWorker("w1")
	if err := r.Add(w1); err != nil {
		t.Fatal(err)
	}
	// Duplicate
	if err := r.Add(w1); err == nil {
		t.Error("expected duplicate error")
	}
}

func TestRegistrySetBusy(t *testing.T) {
	r := testRegistry(t)
	r.Add(testWorker("w"))
	r.Start("w")

	if err := r.SetBusy("w"); err != nil {
		t.Fatalf("SetBusy: %v", err)
	}
	e, _ := r.Get("w")
	if e.State != StateBusy {
		t.Errorf("state = %q, want busy", e.State)
	}

	// offline → busy should fail
	r.Add(testWorker("w2"))
	if err := r.SetBusy("w2"); err == nil {
		t.Error("expected error for offline→busy")
	}
}

func TestRegistrySetOnline(t *testing.T) {
	r := testRegistry(t)
	r.Add(testWorker("w"))
	r.Start("w")
	r.SetBusy("w")

	if err := r.SetOnline("w"); err != nil {
		t.Fatalf("SetOnline: %v", err)
	}
	e, _ := r.Get("w")
	if e.State != StateOnline {
		t.Errorf("state = %q, want online", e.State)
	}

	// online → online should fail
	if err := r.SetOnline("w"); err == nil {
		t.Error("expected error for online→online")
	}
}

func TestRegistryReload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	r, _ := NewRegistry(db)
	r.Add(testWorker("w1"))
	r.Start("w1")

	// Simulate CLI adding a worker via separate connection
	db2, _ := store.Open(path)
	r2, _ := NewRegistry(db2)
	w2 := &Worker{Name: "w2", Endpoint: "http://y"}
	r2.Add(w2)
	db2.Close()

	// Reload should pick up w2
	if err := r.Reload(); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if _, ok := r.Get("w2"); !ok {
		t.Error("w2 not found after Reload")
	}
	// w1 should still be present
	e1, ok := r.Get("w1")
	if !ok {
		t.Error("w1 lost after Reload")
	}
	if e1.State != StateOnline {
		t.Errorf("w1 state = %q after Reload", e1.State)
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
