package cli

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mecha.im/internal/worker"
)

func TestAdapterStartNotFound(t *testing.T) {
	reg := newTestRegistry(t)
	err := adapterStart(reg, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent worker")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want containing 'not found'", err)
	}
}

func TestAdapterStartUnhealthyUpstream(t *testing.T) {
	// Upstream returns 500 → health check fails
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	reg := newTestRegistry(t)
	reg.Add(&worker.Worker{
		Name: "unhealthy-adapter",
		Adapter: &worker.AdapterConfig{
			Type:     "ollama",
			Upstream: srv.URL,
			Model:    "test",
		},
	})

	err := adapterStart(reg, "unhealthy-adapter")
	if err == nil {
		t.Fatal("expected error for unhealthy upstream")
	}
	if !strings.Contains(err.Error(), "health check") {
		t.Errorf("error = %q, want containing 'health check'", err)
	}
	// Worker should be in error state
	e, _ := reg.Get("unhealthy-adapter")
	if e.State != worker.StateError {
		t.Errorf("state = %s, want error", e.State)
	}
}

func TestAdapterStartUnknownType(t *testing.T) {
	reg := newTestRegistry(t)
	reg.Add(&worker.Worker{
		Name: "bad-type",
		Adapter: &worker.AdapterConfig{
			Type:     "vllm",
			Upstream: "http://localhost:1",
			Model:    "test",
		},
	})

	err := adapterStart(reg, "bad-type")
	if err == nil {
		t.Fatal("expected error for unknown adapter type")
	}
	if !strings.Contains(err.Error(), "unknown adapter") {
		t.Errorf("error = %q, want containing 'unknown adapter'", err)
	}
}

func TestAdapterStartHealthyUpstream(t *testing.T) {
	// Upstream returns 200 → should start successfully
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	reg := newTestRegistry(t)
	reg.Add(&worker.Worker{
		Name: "healthy-adapter",
		Adapter: &worker.AdapterConfig{
			Type:     "ollama",
			Upstream: srv.URL,
			Model:    "test",
		},
	})

	err := adapterStart(reg, "healthy-adapter")
	if err != nil {
		t.Fatalf("adapterStart: %v", err)
	}
	defer adapterStop("healthy-adapter")

	e, ok := reg.Get("healthy-adapter")
	if !ok {
		t.Fatal("worker should exist")
	}
	if e.RuntimeEndpoint == "" {
		t.Error("runtime endpoint should be set")
	}
	if e.State != worker.StateOnline {
		t.Errorf("state = %s, want online", e.State)
	}
}

func TestWorkerCmdStructure(t *testing.T) {
	cmd := workerCmd()
	if cmd.Use != "worker" {
		t.Errorf("use = %q, want worker", cmd.Use)
	}
	// Should have 5 subcommands: add, remove, start, stop, ls
	subs := cmd.Commands()
	names := make(map[string]bool)
	for _, c := range subs {
		names[c.Use] = true
	}
	for _, want := range []string{"add <path>", "remove <name>", "start <name>", "stop <name>", "ls"} {
		if !names[want] {
			t.Errorf("missing subcommand %q", want)
		}
	}
}
