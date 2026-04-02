package cli

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mecha.im/internal/store"
	"mecha.im/internal/workers"
)

func TestWorkerLsCmdEmpty(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerLsCmd()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = w

	runErr := cmd.RunE(cmd, []string{})

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if runErr != nil {
		t.Fatalf("workerLsCmd: %v", runErr)
	}
	if !strings.Contains(got, "no workers registered") {
		t.Errorf("empty ls should say 'no workers registered', got: %q", got)
	}
}

func TestWorkerLsCmdPopulated(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	workerList := []*workers.Worker{
		{Name: "live-one", Endpoint: "http://localhost:9001"},
		{Name: "live-two", Endpoint: "http://localhost:9002"},
	}
	for _, w := range workerList {
		if err := reg.Add(w); err != nil {
			t.Fatalf("Add %s: %v", w.Name, err)
		}
	}
	db.Close()

	cmd := workerLsCmd()

	r, w2, pipeErr := os.Pipe()
	if pipeErr != nil {
		t.Fatalf("os.Pipe: %v", pipeErr)
	}
	old := os.Stdout
	os.Stdout = w2

	runErr := cmd.RunE(cmd, []string{})

	w2.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if runErr != nil {
		t.Fatalf("workerLsCmd: %v", runErr)
	}
	// Should contain table headers
	if !strings.Contains(got, "NAME") {
		t.Errorf("output should have NAME header, got:\n%s", got)
	}
	if !strings.Contains(got, "live-one") {
		t.Errorf("output should list live-one, got:\n%s", got)
	}
	if !strings.Contains(got, "live-two") {
		t.Errorf("output should list live-two, got:\n%s", got)
	}
}

func TestProbeHealthConcurrentOffline(t *testing.T) {
	entries := []workers.Entry{
		{
			Worker: &workers.Worker{Name: "w1", Endpoint: "http://localhost:1"},
			State:  workers.StateOffline,
		},
		{
			Worker: &workers.Worker{Name: "w2", Endpoint: ""},
			State:  workers.StateOffline,
		},
	}
	results := probeHealthConcurrent(entries)
	if len(results) != 2 {
		t.Fatalf("got %d results, want 2", len(results))
	}
	for i, r := range results {
		if r != "-" {
			t.Errorf("results[%d] = %q, want '-' for offline", i, r)
		}
	}
}

func TestProbeHealthConcurrentError(t *testing.T) {
	entries := []workers.Entry{
		{
			Worker: &workers.Worker{Name: "w1", Endpoint: "http://localhost:1"},
			State:  workers.StateError,
			Error:  "connection refused",
		},
	}
	results := probeHealthConcurrent(entries)
	if len(results) != 1 {
		t.Fatalf("got %d results, want 1", len(results))
	}
	if results[0] != "connection refused" {
		t.Errorf("results[0] = %q, want 'connection refused'", results[0])
	}
}

func TestProbeHealthConcurrentOnlineHealthy(t *testing.T) {
	// Start a mock health endpoint
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	entries := []workers.Entry{
		{
			Worker: &workers.Worker{Name: "healthy", Endpoint: srv.URL},
			State:  workers.StateOnline,
		},
	}
	results := probeHealthConcurrent(entries)
	if len(results) != 1 {
		t.Fatalf("got %d results, want 1", len(results))
	}
	if results[0] != "ok" {
		t.Errorf("results[0] = %q, want 'ok'", results[0])
	}
}

func TestProbeHealthConcurrentOnlineUnreachable(t *testing.T) {
	// Use a port that is guaranteed to not be listening
	entries := []workers.Entry{
		{
			Worker: &workers.Worker{Name: "down", Endpoint: "http://127.0.0.1:1"},
			State:  workers.StateOnline,
		},
	}
	results := probeHealthConcurrent(entries)
	if len(results) != 1 {
		t.Fatalf("got %d results, want 1", len(results))
	}
	if results[0] != "unreachable" {
		t.Errorf("results[0] = %q, want 'unreachable'", results[0])
	}
}

func TestProbeHealthConcurrentRuntimeEndpoint(t *testing.T) {
	// When RuntimeEndpoint is set, it should be used instead of Worker.Endpoint
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	entries := []workers.Entry{
		{
			Worker:          &workers.Worker{Name: "runtime", Endpoint: "http://127.0.0.1:1"},
			State:           workers.StateOnline,
			RuntimeEndpoint: srv.URL,
		},
	}
	results := probeHealthConcurrent(entries)
	if results[0] != "ok" {
		t.Errorf("results[0] = %q, want 'ok' (should use RuntimeEndpoint)", results[0])
	}
}

func TestProbeHealthConcurrentMixed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	entries := []workers.Entry{
		{
			Worker: &workers.Worker{Name: "offline-w"},
			State:  workers.StateOffline,
		},
		{
			Worker: &workers.Worker{Name: "healthy-w", Endpoint: srv.URL},
			State:  workers.StateOnline,
		},
		{
			Worker: &workers.Worker{Name: "error-w", Endpoint: "http://localhost:1"},
			State:  workers.StateError,
			Error:  "some error",
		},
		{
			Worker: &workers.Worker{Name: "no-ep"},
			State:  workers.StateOnline,
		},
	}
	results := probeHealthConcurrent(entries)
	if len(results) != 4 {
		t.Fatalf("got %d results, want 4", len(results))
	}
	expected := []string{"-", "ok", "some error", "-"}
	for i, want := range expected {
		if results[i] != want {
			t.Errorf("results[%d] = %q, want %q", i, results[i], want)
		}
	}
}

func TestProbeHealthConcurrentErrorRedaction(t *testing.T) {
	entries := []workers.Entry{
		{
			Worker: &workers.Worker{Name: "secret-error", Endpoint: "http://localhost:1"},
			State:  workers.StateError,
			Error:  "token was ghp_abc123secret",
		},
	}
	results := probeHealthConcurrent(entries)
	// Error string should go through RedactSecrets
	if strings.Contains(results[0], "ghp_abc123secret") {
		t.Errorf("error should be redacted, got: %q", results[0])
	}
}
