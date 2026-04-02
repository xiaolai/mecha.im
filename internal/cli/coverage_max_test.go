package cli

import (
	"path/filepath"
	"testing"

	"mecha.im/internal/store"
	"mecha.im/internal/workers"
)

// --- registry: error paths ---

func TestRegistryClosedDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	_, err = workers.NewRegistry(db)
	if err == nil {
		t.Error("expected error from closed DB")
	}
}

// --- isReservedEnvKey ---

func TestIsReservedEnvKeyCaseSensitivity(t *testing.T) {
	tests := []struct {
		key  string
		want bool
	}{
		{"WORKER_BACKEND", true},
		{"worker_backend", true},
		{"Worker_Backend", true},
		{"HOME", true},
		{"home", true},
		{"CUSTOM_VAR", false},
		{"WORKER_API_KEY", true},
		{"WORKER_TIMEOUT", true},
		{"WORKER_DRY_RUN", true},
		{"WORKER_PORT", true},
		{"CLAUDE_MODEL", false},
	}
	for _, tt := range tests {
		got := isReservedEnvKey(tt.key)
		if got != tt.want {
			t.Errorf("isReservedEnvKey(%q) = %v, want %v", tt.key, got, tt.want)
		}
	}
}

// --- dockerStart: worker not found ---

func TestDockerStartWorkerNotFound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}

	err = dockerStart(reg, "nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent worker")
	}
}

// --- dockerStop: worker not found ---

func TestDockerStopWorkerNotFound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}

	err = dockerStop(reg, "nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent worker")
	}
}

// --- dockerRemove: worker not found ---

func TestDockerRemoveWorkerNotFound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}

	err = dockerRemove(reg, "nonexistent")
	if err != nil {
		t.Errorf("dockerRemove for nonexistent should return nil, got %v", err)
	}
}

// --- dockerStop: worker with empty container ID ---

func TestDockerStopEmptyContainerID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}

	w := &workers.Worker{
		Name: "empty-cid",
		Docker: &workers.DockerConfig{
			Image: "test:latest",
		},
	}
	reg.Add(w)
	reg.Start("empty-cid")

	err = dockerStop(reg, "empty-cid")
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}
