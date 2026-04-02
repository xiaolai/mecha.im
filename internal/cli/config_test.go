package cli

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mecha.im/internal/store"
	"mecha.im/internal/workers"
)

func newTestRegistry(t *testing.T) *workers.Registry {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	return reg
}

func TestPrintYAML(t *testing.T) {
	// printYAML writes to os.Stdout. Capture it.
	w := &workers.Worker{
		Name:     "test-worker",
		Endpoint: "http://localhost:9000",
	}

	r, wPipe, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = wPipe

	encErr := printYAML(w)

	wPipe.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if encErr != nil {
		t.Fatalf("printYAML error: %v", encErr)
	}
	if !strings.Contains(got, "name: test-worker") {
		t.Errorf("output should contain 'name: test-worker', got:\n%s", got)
	}
	if !strings.Contains(got, "endpoint: http://localhost:9000") {
		t.Errorf("output should contain endpoint, got:\n%s", got)
	}
}

func TestPrintYAMLDocker(t *testing.T) {
	w := &workers.Worker{
		Name: "managed-worker",
		Docker: &workers.DockerConfig{
			Image: "ghcr.io/test:v1",
			Env:   map[string]string{"FOO": "bar"},
		},
	}

	r, wPipe, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = wPipe

	encErr := printYAML(w)

	wPipe.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if encErr != nil {
		t.Fatalf("printYAML error: %v", encErr)
	}
	if !strings.Contains(got, "image: ghcr.io/test:v1") {
		t.Errorf("output should contain image, got:\n%s", got)
	}
}

func TestShowWorkerConfig(t *testing.T) {
	reg := newTestRegistry(t)
	w := &workers.Worker{
		Name:     "show-test",
		Endpoint: "http://localhost:8000",
	}
	if err := reg.Add(w); err != nil {
		t.Fatalf("Add: %v", err)
	}

	// Redirect stdout to capture output
	r, wPipe, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = wPipe

	showErr := showWorkerConfig(reg, "show-test")

	wPipe.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if showErr != nil {
		t.Fatalf("showWorkerConfig error: %v", showErr)
	}
	if !strings.Contains(got, "name: show-test") {
		t.Errorf("output should contain worker name, got:\n%s", got)
	}
}

func TestShowWorkerConfigNotFound(t *testing.T) {
	reg := newTestRegistry(t)
	err := showWorkerConfig(reg, "nonexistent")
	if err == nil {
		t.Fatal("expected error for missing worker")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want containing 'not found'", err)
	}
}

func TestShowAllConfigEmpty(t *testing.T) {
	reg := newTestRegistry(t)

	r, wPipe, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = wPipe

	showErr := showAllConfig(reg)

	wPipe.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if showErr != nil {
		t.Fatalf("showAllConfig error: %v", showErr)
	}
	if !strings.Contains(got, "no workers registered") {
		t.Errorf("empty registry should say 'no workers registered', got:\n%s", got)
	}
}

func TestShowAllConfigMultiple(t *testing.T) {
	reg := newTestRegistry(t)
	for _, name := range []string{"alpha", "bravo"} {
		if err := reg.Add(&workers.Worker{Name: name, Endpoint: "http://localhost:9000"}); err != nil {
			t.Fatalf("Add %s: %v", name, err)
		}
	}

	r, wPipe, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = wPipe

	showErr := showAllConfig(reg)

	wPipe.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if showErr != nil {
		t.Fatalf("showAllConfig error: %v", showErr)
	}
	if !strings.Contains(got, "name: alpha") {
		t.Errorf("output should contain alpha, got:\n%s", got)
	}
	if !strings.Contains(got, "name: bravo") {
		t.Errorf("output should contain bravo, got:\n%s", got)
	}
	if !strings.Contains(got, "---") {
		t.Errorf("output should contain YAML document separator, got:\n%s", got)
	}
}

func TestConfigCmdIntegration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	t.Setenv("MECHA_DB_PATH", path)

	// Open and populate DB
	db, err := store.Open(path)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	if err := reg.Add(&workers.Worker{Name: "cfg-test", Endpoint: "http://localhost:5555"}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	db.Close()

	// Test config with a specific worker name
	cmd := configCmd()
	cmd.SetArgs([]string{"cfg-test"})

	r, wPipe, pipeErr := os.Pipe()
	if pipeErr != nil {
		t.Fatalf("os.Pipe: %v", pipeErr)
	}
	old := os.Stdout
	os.Stdout = wPipe

	runErr := cmd.RunE(cmd, []string{"cfg-test"})

	wPipe.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if runErr != nil {
		t.Fatalf("configCmd RunE: %v", runErr)
	}
	if !strings.Contains(got, "cfg-test") {
		t.Errorf("output should contain worker name, got:\n%s", got)
	}
}

func TestConfigCmdNotFound(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	t.Setenv("MECHA_DB_PATH", path)

	db, err := store.Open(path)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	db.Close()

	cmd := configCmd()
	runErr := cmd.RunE(cmd, []string{"missing"})
	if runErr == nil {
		t.Fatal("expected error for missing worker")
	}
	if !strings.Contains(runErr.Error(), "not found") {
		t.Errorf("error = %q, want containing 'not found'", runErr)
	}
}
