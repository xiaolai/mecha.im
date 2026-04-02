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

func TestWorkerAddCmdFile(t *testing.T) {
	// Create a temp YAML worker file
	dir := t.TempDir()
	yamlPath := filepath.Join(dir, "live-worker.yml")
	content := `name: live-worker
endpoint: http://localhost:9999
timeout: 5m
`
	if err := os.WriteFile(yamlPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write yaml: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerAddCmd()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = w

	runErr := cmd.RunE(cmd, []string{yamlPath})

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if runErr != nil {
		t.Fatalf("workerAddCmd: %v", runErr)
	}
	if !strings.Contains(got, "added live-worker") {
		t.Errorf("output = %q, want containing 'added live-worker'", got)
	}
	if !strings.Contains(got, "live") {
		t.Errorf("output = %q, want containing type 'live'", got)
	}
}

func TestWorkerAddCmdDir(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"alpha", "bravo"} {
		yamlPath := filepath.Join(dir, name+".yml")
		content := "name: " + name + "\nendpoint: http://localhost:9999\n"
		if err := os.WriteFile(yamlPath, []byte(content), 0o644); err != nil {
			t.Fatalf("write yaml: %v", err)
		}
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerAddCmd()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = w

	runErr := cmd.RunE(cmd, []string{dir})

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if runErr != nil {
		t.Fatalf("workerAddCmd dir: %v", runErr)
	}
	if !strings.Contains(got, "added alpha") {
		t.Errorf("output = %q, want containing 'added alpha'", got)
	}
	if !strings.Contains(got, "added bravo") {
		t.Errorf("output = %q, want containing 'added bravo'", got)
	}
}

func TestWorkerAddCmdDuplicate(t *testing.T) {
	dir := t.TempDir()
	yamlPath := filepath.Join(dir, "dup.yml")
	content := "name: dup-worker\nendpoint: http://localhost:9999\n"
	if err := os.WriteFile(yamlPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write yaml: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerAddCmd()
	// First add succeeds
	if err := cmd.RunE(cmd, []string{yamlPath}); err != nil {
		t.Fatalf("first add: %v", err)
	}
	// Second add should fail with "already exists"
	cmd2 := workerAddCmd()
	err := cmd2.RunE(cmd2, []string{yamlPath})
	if err == nil {
		t.Fatal("expected error on duplicate add")
	}
	if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("error = %q, want containing 'already exists'", err)
	}
}

func TestWorkerAddCmdInvalidYAML(t *testing.T) {
	dir := t.TempDir()
	yamlPath := filepath.Join(dir, "bad.yml")
	// Invalid: no name field
	content := "endpoint: http://localhost:9999\n"
	if err := os.WriteFile(yamlPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write yaml: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerAddCmd()
	err := cmd.RunE(cmd, []string{yamlPath})
	if err == nil {
		t.Fatal("expected error for invalid YAML (no name)")
	}
}

func TestWorkerAddCmdNonexistentPath(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerAddCmd()
	err := cmd.RunE(cmd, []string{"/nonexistent/path/worker.yml"})
	if err == nil {
		t.Fatal("expected error for nonexistent path")
	}
}

func TestWorkerAddDirDuplicate(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"first", "second"} {
		yamlPath := filepath.Join(dir, name+".yml")
		content := "name: " + name + "\nendpoint: http://localhost:9999\n"
		if err := os.WriteFile(yamlPath, []byte(content), 0o644); err != nil {
			t.Fatalf("write yaml: %v", err)
		}
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	// Pre-add "first" to make the batch fail
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	if err := reg.Add(&workers.Worker{Name: "first", Endpoint: "http://localhost:1111"}); err != nil {
		t.Fatalf("pre-add: %v", err)
	}
	db.Close()

	cmd := workerAddCmd()
	runErr := cmd.RunE(cmd, []string{dir})
	if runErr == nil {
		t.Fatal("expected error for batch with duplicate")
	}
	if !strings.Contains(runErr.Error(), "already exists") {
		t.Errorf("error = %q, want containing 'already exists'", runErr)
	}
}

func TestAddFile(t *testing.T) {
	reg := newTestRegistry(t)
	dir := t.TempDir()
	yamlPath := filepath.Join(dir, "worker.yml")
	content := "name: add-file-test\nendpoint: http://localhost:9000\n"
	if err := os.WriteFile(yamlPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write yaml: %v", err)
	}

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = w

	addErr := addFile(reg, yamlPath)

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)

	if addErr != nil {
		t.Fatalf("addFile: %v", addErr)
	}
	if _, ok := reg.Get("add-file-test"); !ok {
		t.Error("worker should exist in registry after addFile")
	}
}

func TestAddDir(t *testing.T) {
	reg := newTestRegistry(t)
	dir := t.TempDir()
	for _, name := range []string{"dir-a", "dir-b"} {
		yamlPath := filepath.Join(dir, name+".yml")
		content := "name: " + name + "\nendpoint: http://localhost:9000\n"
		if err := os.WriteFile(yamlPath, []byte(content), 0o644); err != nil {
			t.Fatalf("write yaml: %v", err)
		}
	}

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = w

	addErr := addDir(reg, dir)

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)

	if addErr != nil {
		t.Fatalf("addDir: %v", addErr)
	}
	for _, name := range []string{"dir-a", "dir-b"} {
		if _, ok := reg.Get(name); !ok {
			t.Errorf("worker %q should exist in registry after addDir", name)
		}
	}
}

func TestWorkerRemoveCmdLive(t *testing.T) {
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
	if err := reg.Add(&workers.Worker{Name: "removable", Endpoint: "http://localhost:1111"}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	db.Close()

	cmd := workerRemoveCmd()

	r, w, pipeErr := os.Pipe()
	if pipeErr != nil {
		t.Fatalf("os.Pipe: %v", pipeErr)
	}
	old := os.Stdout
	os.Stdout = w

	runErr := cmd.RunE(cmd, []string{"removable"})

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if runErr != nil {
		t.Fatalf("workerRemoveCmd: %v", runErr)
	}
	if !strings.Contains(got, "removed removable") {
		t.Errorf("output = %q, want containing 'removed removable'", got)
	}
}

func TestWorkerRemoveCmdNotFound(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerRemoveCmd()
	err := cmd.RunE(cmd, []string{"ghost"})
	if err == nil {
		t.Fatal("expected error for removing nonexistent worker")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want containing 'not found'", err)
	}
}

func TestWorkerStartCmdNotFound(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerStartCmd()
	err := cmd.RunE(cmd, []string{"ghost"})
	if err == nil {
		t.Fatal("expected error for starting nonexistent worker")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want containing 'not found'", err)
	}
}

func TestWorkerStartCmdAdapterReject(t *testing.T) {
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
	if err := reg.Add(&workers.Worker{
		Name: "adapter-worker",
		Adapter: &workers.AdapterConfig{
			Type:     "ollama",
			Upstream: "http://localhost:11434",
			Model:    "gemma2:9b",
		},
	}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	db.Close()

	cmd := workerStartCmd()
	runErr := cmd.RunE(cmd, []string{"adapter-worker"})
	if runErr == nil {
		t.Fatal("expected error for adapter worker start")
	}
	if !strings.Contains(runErr.Error(), "mecha serve") {
		t.Errorf("error = %q, want containing 'mecha serve'", runErr)
	}
}

func TestWorkerStopCmdNotFound(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerStopCmd()
	err := cmd.RunE(cmd, []string{"ghost"})
	if err == nil {
		t.Fatal("expected error for stopping nonexistent worker")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want containing 'not found'", err)
	}
}

func TestWorkerStopCmdLiveOffline(t *testing.T) {
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
	// Add a live worker that is offline — stopping should fail
	if err := reg.Add(&workers.Worker{Name: "offline-live", Endpoint: "http://localhost:1111"}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	db.Close()

	cmd := workerStopCmd()
	runErr := cmd.RunE(cmd, []string{"offline-live"})
	if runErr == nil {
		t.Fatal("expected error stopping an offline worker")
	}
	if !strings.Contains(runErr.Error(), "offline") || !strings.Contains(runErr.Error(), "online or error") {
		t.Errorf("error = %q, should mention state requirements", runErr)
	}
}

func TestRegistryHelperUsesEnv(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	// registry() should create DB at the env path and return a valid registry
	reg := registry()
	if reg == nil {
		t.Fatal("registry() returned nil")
	}
	// List should be empty
	entries := reg.List()
	if len(entries) != 0 {
		t.Errorf("fresh registry has %d entries, want 0", len(entries))
	}
}

func TestWorkerAddAdapterYAML(t *testing.T) {
	dir := t.TempDir()
	yamlPath := filepath.Join(dir, "adapter.yml")
	content := `name: ollama-local
adapter:
  type: ollama
  upstream: http://localhost:11434
  model: gemma2:9b
timeout: 10m
`
	if err := os.WriteFile(yamlPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write yaml: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := workerAddCmd()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = w

	runErr := cmd.RunE(cmd, []string{yamlPath})

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	got := buf.String()

	if runErr != nil {
		t.Fatalf("workerAddCmd adapter: %v", runErr)
	}
	if !strings.Contains(got, "added ollama-local") {
		t.Errorf("output = %q, want containing 'added ollama-local'", got)
	}
	if !strings.Contains(got, "adapter") {
		t.Errorf("output = %q, want containing type 'adapter'", got)
	}
}
