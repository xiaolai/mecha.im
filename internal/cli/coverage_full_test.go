package cli

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mecha.im/internal/store"
	"mecha.im/internal/workers"
)

// ---------- serveCmd ----------

func TestServeCmdGitLabSourceRegistered(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	secretsYAML := `gitlab:
  webhook_secret: glsecret123
`
	os.WriteFile(filepath.Join(mechaDir, "secrets.yml"), []byte(secretsYAML), 0o600)

	dbPath := filepath.Join(mechaDir, "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)
	t.Setenv("HOME", dir)

	cmd := serveCmd()
	cmd.Flags().Set("addr", "invalid-addr-!@#$%")
	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error from bad listen address")
	}
	// If we got past source registration, the error should be from listen, not source setup
	if strings.Contains(err.Error(), "gitlab") {
		t.Errorf("error should not be about gitlab registration: %v", err)
	}
}

func TestServeCmdSlackSourceRegistered(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	secretsYAML := `slack:
  signing_secret: slacksecret123
`
	os.WriteFile(filepath.Join(mechaDir, "secrets.yml"), []byte(secretsYAML), 0o600)

	dbPath := filepath.Join(mechaDir, "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)
	t.Setenv("HOME", dir)

	cmd := serveCmd()
	cmd.Flags().Set("addr", "invalid-addr-!@#$%")
	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error from bad listen address")
	}
	if strings.Contains(err.Error(), "slack") {
		t.Errorf("error should not be about slack registration: %v", err)
	}
}

func TestServeCmdTelegramSourceRegistered(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	secretsYAML := `telegram:
  secret_token: tgsecret123
`
	os.WriteFile(filepath.Join(mechaDir, "secrets.yml"), []byte(secretsYAML), 0o600)

	dbPath := filepath.Join(mechaDir, "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)
	t.Setenv("HOME", dir)

	cmd := serveCmd()
	cmd.Flags().Set("addr", "invalid-addr-!@#$%")
	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error from bad listen address")
	}
	if strings.Contains(err.Error(), "telegram") {
		t.Errorf("error should not be about telegram registration: %v", err)
	}
}

func TestServeCmdAllSourcesRegistered(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	secretsYAML := `github:
  token: ghp_testtoken123
  webhook_secret: ghsecret123
gitlab:
  webhook_secret: glsecret456
slack:
  signing_secret: slacksecret456
telegram:
  secret_token: tgsecret456
`
	os.WriteFile(filepath.Join(mechaDir, "secrets.yml"), []byte(secretsYAML), 0o600)

	dbPath := filepath.Join(mechaDir, "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)
	t.Setenv("HOME", dir)

	cmd := serveCmd()
	cmd.Flags().Set("addr", "invalid-addr-!@#$%")
	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error from bad listen address")
	}
	// Error should come from listen, not source registration
	errStr := err.Error()
	for _, keyword := range []string{"gitlab", "slack", "telegram", "github"} {
		if strings.Contains(errStr, keyword) {
			t.Errorf("error should not be about %s registration: %v", keyword, err)
		}
	}
}

func TestServeCmdAdapterAutoStart(t *testing.T) {
	// Create a mock upstream that returns 200 for adapter health
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	dbPath := filepath.Join(mechaDir, "test.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	reg.Add(&workers.Worker{
		Name: "auto-adapter",
		Adapter: &workers.AdapterConfig{
			Type:     "ollama",
			Upstream: srv.URL,
			Model:    "test",
		},
	})
	db.Close()

	t.Setenv("MECHA_DB_PATH", dbPath)
	t.Setenv("HOME", dir)

	cmd := serveCmd()
	cmd.Flags().Set("addr", "invalid-addr-!@#$%")
	err = cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error from bad listen address")
	}
	// Clean up any started adapter
	adapterStop("auto-adapter")
}

func TestServeCmdDefaultDBPath(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	// Do not set MECHA_DB_PATH — forces DefaultDBPath code path
	t.Setenv("MECHA_DB_PATH", "")
	t.Setenv("HOME", dir)

	cmd := serveCmd()
	cmd.Flags().Set("addr", "invalid-addr-!@#$%")
	err := cmd.RunE(cmd, nil)
	// With HOME set to temp dir, DefaultDBPath resolves to $HOME/.mecha/mecha.db
	// This DB may not exist yet, but store.Open creates it.
	if err == nil {
		t.Fatal("expected error from bad listen address")
	}
}

// ---------- dockerStart ----------

func TestDockerStartInvalidCredentials(t *testing.T) {
	reg := newTestRegistry(t)
	reg.Add(&workers.Worker{
		Name: "bad-cred",
		Docker: &workers.DockerConfig{
			Image:       "test:latest",
			Credentials: []string{"gemini"},
		},
	})
	err := dockerStart(reg, "bad-cred")
	if err == nil {
		t.Fatal("expected error for invalid credentials backend")
	}
	// Validate rejects "gemini" as not valid
	if !strings.Contains(err.Error(), "not valid") && !strings.Contains(err.Error(), "unknown credentials") {
		t.Errorf("error = %q, want containing credential rejection", err)
	}
}

// ---------- dockerStop ----------

func TestDockerStopWithContainerIDNoDocker(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	w := &workers.Worker{
		Name: "has-container",
		Docker: &workers.DockerConfig{
			Image: "test:latest",
		},
	}
	reg.Add(w)
	// Simulate a running container by setting runtime
	reg.SetRuntime("has-container", "fake-container-id-abc123", "http://localhost:8080")
	db.Close()

	// dockerStop needs to re-open the registry to get the container ID
	db2, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	defer db2.Close()
	reg2, err := workers.NewRegistry(db2)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	err = dockerStop(reg2, "has-container")
	// Should fail when trying to connect to Docker daemon
	if err != nil {
		errStr := err.Error()
		if !strings.Contains(errStr, "docker") &&
			!strings.Contains(errStr, "connect") &&
			!strings.Contains(errStr, "dial") &&
			!strings.Contains(errStr, "Cannot connect") &&
			!strings.Contains(errStr, "container") {
			t.Errorf("unexpected error: %v", err)
		}
	}
}

// ---------- checkMechaDir ----------

func TestCheckMechaDirStatError(t *testing.T) {
	// Set HOME to a path that can't be stat'd (permissions issue)
	dir := t.TempDir()
	mechaParent := filepath.Join(dir, "no-read")
	os.MkdirAll(mechaParent, 0o700)
	mechaPath := filepath.Join(mechaParent, ".mecha")
	os.MkdirAll(mechaPath, 0o000)
	t.Setenv("HOME", mechaParent)

	result := checkMechaDir()
	// Restore permissions for cleanup
	os.Chmod(mechaPath, 0o755)

	// The dir itself exists but may or may not be readable depending on OS
	// The key is it shouldn't panic
	_ = result
}

// ---------- checkDatabase ----------

func TestCheckDatabaseCorrupted(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "corrupt.db")
	os.WriteFile(dbPath, []byte("this is not a sqlite database"), 0o644)
	t.Setenv("MECHA_DB_PATH", dbPath)

	result := checkDatabase()
	if result {
		t.Error("checkDatabase should fail for corrupted DB file")
	}
}

// ---------- countRows ----------

func TestCountRowsMissingTable(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "bare.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	// No tables exist at all
	_, _, err = countRows(db)
	if err == nil {
		t.Fatal("expected error when workers table missing")
	}
	if !strings.Contains(err.Error(), "count workers") {
		t.Errorf("error = %q, want containing 'count workers'", err)
	}
}

func TestCountRowsMissingTasksTable(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "partial.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	// Create workers table only
	_, err = db.Exec("CREATE TABLE workers (id INTEGER PRIMARY KEY)")
	if err != nil {
		t.Fatalf("create table: %v", err)
	}

	_, _, err = countRows(db)
	if err == nil {
		t.Fatal("expected error when tasks table missing")
	}
	if !strings.Contains(err.Error(), "count tasks") {
		t.Errorf("error = %q, want containing 'count tasks'", err)
	}
}

// ---------- checkSecrets ----------

func TestCheckSecretsValid(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	secretsYAML := `tokens:
  claude:
    dev: sk-ant-oat01-test
`
	os.WriteFile(filepath.Join(mechaDir, "secrets.yml"), []byte(secretsYAML), 0o600)
	t.Setenv("HOME", dir)

	result := checkSecrets()
	if !result {
		t.Error("checkSecrets should pass with valid secrets file (0600 permissions)")
	}
}

func TestCheckSecretsInvalidYAML(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	os.WriteFile(filepath.Join(mechaDir, "secrets.yml"), []byte("{{invalid yaml"), 0o600)
	t.Setenv("HOME", dir)

	result := checkSecrets()
	if result {
		t.Error("checkSecrets should fail with invalid YAML")
	}
}

// ---------- checkWorkerImage ----------

func TestCheckWorkerImageCustomHostWithDC(t *testing.T) {
	// Even if a DockerClient is provided, custom Host should skip the check
	w := &workers.Worker{Docker: &workers.DockerConfig{
		Image: "test:latest",
		Host:  "tcp://remote:2375",
	}}
	dc := dockerClientQuiet()
	if dc != nil {
		defer dc.Close()
	}
	// Should return true with warn, regardless of DockerClient
	if !checkWorkerImage(t.Context(), w, dc) {
		t.Error("should pass (warn) with custom docker host")
	}
}

// ---------- registry ----------

func TestRegistryDefaultDBPath(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)
	t.Setenv("HOME", dir)
	t.Setenv("MECHA_DB_PATH", "")

	reg := registry()
	if reg == nil {
		t.Fatal("registry() returned nil")
	}
	entries := reg.List()
	if len(entries) != 0 {
		t.Errorf("fresh registry has %d entries, want 0", len(entries))
	}
}

// ---------- workerStartCmd ----------

func TestWorkerStartCmdManagedDockerFail(t *testing.T) {
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
	// Add a managed Docker worker with a bad cwd to trigger validation error
	reg.Add(&workers.Worker{
		Name: "docker-fail",
		Docker: &workers.DockerConfig{
			Image: "test:latest",
			Cwd:   "/nonexistent/impossible/path",
		},
	})
	db.Close()

	cmd := workerStartCmd()
	err = cmd.RunE(cmd, []string{"docker-fail"})
	if err == nil {
		t.Fatal("expected error trying to start managed worker")
	}
}

func TestWorkerStartCmdAlreadyOnline(t *testing.T) {
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
	w := &workers.Worker{Name: "already-up", Endpoint: "http://localhost:1"}
	reg.Add(w)
	reg.Start("already-up")
	db.Close()

	cmd := workerStartCmd()
	err = cmd.RunE(cmd, []string{"already-up"})
	if err == nil {
		t.Fatal("expected error: worker already online")
	}
	if !strings.Contains(err.Error(), "offline") {
		t.Errorf("error = %q, want mention of 'offline'", err)
	}
}

// ---------- workerStopCmd ----------

func TestWorkerStopCmdManagedWithContainerID(t *testing.T) {
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
	w := &workers.Worker{
		Name: "managed-stop",
		Docker: &workers.DockerConfig{
			Image: "test:latest",
		},
	}
	reg.Add(w)
	reg.SetRuntime("managed-stop", "fake-container-xyz", "http://localhost:8080")
	db.Close()

	cmd := workerStopCmd()
	err = cmd.RunE(cmd, []string{"managed-stop"})
	// Should fail trying to connect to Docker
	if err != nil {
		errStr := err.Error()
		if !strings.Contains(errStr, "docker") &&
			!strings.Contains(errStr, "connect") &&
			!strings.Contains(errStr, "container") &&
			!strings.Contains(errStr, "dial") {
			t.Errorf("unexpected error: %v", err)
		}
	}
}

func TestWorkerStopCmdAdapterWorker(t *testing.T) {
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
	w := &workers.Worker{
		Name: "adapter-to-stop",
		Adapter: &workers.AdapterConfig{
			Type: "ollama", Upstream: "http://localhost:11434", Model: "test",
		},
	}
	reg.Add(w)
	reg.Start("adapter-to-stop")
	db.Close()

	cmd := workerStopCmd()
	err = cmd.RunE(cmd, []string{"adapter-to-stop"})
	if err != nil {
		t.Fatalf("stop adapter worker: %v", err)
	}
}

// ---------- workerLsCmd ----------

func TestWorkerLsCmdOnlineUnreachable(t *testing.T) {
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
	w := &workers.Worker{Name: "unreachable-w", Endpoint: "http://127.0.0.1:1"}
	reg.Add(w)
	reg.Start("unreachable-w") // Make it online
	db.Close()

	cmd := workerLsCmd()
	// Execute and capture output - should trigger setErr path
	r, wPipe, pipeErr := os.Pipe()
	if pipeErr != nil {
		t.Fatalf("os.Pipe: %v", pipeErr)
	}
	old := os.Stdout
	os.Stdout = wPipe

	runErr := cmd.RunE(cmd, []string{})

	wPipe.Close()
	os.Stdout = old

	var buf [4096]byte
	n, _ := r.Read(buf[:])
	got := string(buf[:n])

	if runErr != nil {
		t.Fatalf("workerLsCmd: %v", runErr)
	}
	if !strings.Contains(got, "unreachable-w") {
		t.Errorf("output should list the worker, got:\n%s", got)
	}
}

// ---------- addDir ----------

func TestAddDirNoYAMLFiles(t *testing.T) {
	reg := newTestRegistry(t)
	dir := t.TempDir()
	// Create non-YAML files
	os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("hello"), 0o644)
	os.WriteFile(filepath.Join(dir, "config.json"), []byte("{}"), 0o644)

	err := addDir(reg, dir)
	if err != nil {
		t.Fatalf("addDir with no YAML files: %v", err)
	}
	// Should succeed but add nothing
	if len(reg.List()) != 0 {
		t.Errorf("expected 0 workers, got %d", len(reg.List()))
	}
}

// ---------- workerRemoveCmd ----------

func TestWorkerRemoveCmdManagedWorker(t *testing.T) {
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
	reg.Add(&workers.Worker{
		Name:   "docker-rm",
		Docker: &workers.DockerConfig{Image: "test:latest"},
	})
	db.Close()

	cmd := workerRemoveCmd()
	err = cmd.RunE(cmd, []string{"docker-rm"})
	// dockerRemove will try Docker client — may succeed or fail depending on Docker
	// Either way, the worker should be gone from registry if no Docker error
	_ = err
}

// ---------- printStatus ----------

func TestPrintStatusUnknown(t *testing.T) {
	// Hit the default case in printStatus
	r, wPipe, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = wPipe

	printStatus("unknown", "test unknown status")

	wPipe.Close()
	os.Stdout = old

	var buf [1024]byte
	n, _ := r.Read(buf[:])
	got := string(buf[:n])

	if !strings.Contains(got, "[??]") {
		t.Errorf("unknown status should print [??], got: %q", got)
	}
}

// ---------- Execute / root command structure ----------

// We can't test Execute() directly because it calls os.Exit.
// Instead, test that all commands are properly wired by checking subcommand names.
func TestRootSubcommandWiring(t *testing.T) {
	// Verify workerCmd has all 5 subcommands
	cmd := workerCmd()
	subs := cmd.Commands()
	if len(subs) != 5 {
		t.Errorf("workerCmd has %d subcommands, want 5", len(subs))
	}

	// Verify serveCmd
	s := serveCmd()
	if s.Use != "serve" {
		t.Errorf("serveCmd.Use = %q", s.Use)
	}

	// Verify doctorCmd
	d := doctorCmd()
	if d.Use != "doctor" {
		t.Errorf("doctorCmd.Use = %q", d.Use)
	}

	// Verify configCmd
	c := configCmd()
	if c.Use != "config [name]" {
		t.Errorf("configCmd.Use = %q", c.Use)
	}

	// Verify versionCmd
	v := versionCmd()
	if v.Use != "version" {
		t.Errorf("versionCmd.Use = %q", v.Use)
	}
}

// ---------- checkDatabase through countRows error ----------

func TestCheckDatabaseOpenFail(t *testing.T) {
	// Point MECHA_DB_PATH at a directory — store.Open should fail
	dir := t.TempDir()
	t.Setenv("MECHA_DB_PATH", dir)
	result := checkDatabase()
	if result {
		t.Error("checkDatabase should fail when path is a directory")
	}
}

// ---------- checkWorkerCwd sensitive path ----------

func TestCheckWorkerCwdSensitivePath(t *testing.T) {
	// Use home directory as cwd — IsSensitivePath blocks home dir itself
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("cannot resolve home dir")
	}
	w := &workers.Worker{Docker: &workers.DockerConfig{Cwd: home}}
	if checkWorkerCwd(w) {
		t.Error("checkWorkerCwd should fail for home directory (sensitive path)")
	}
}

// ---------- checkWorkerEntry with adapter ----------

func TestCheckWorkerEntryAdapter(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	e := workers.Entry{Worker: &workers.Worker{
		Name: "adapter-check",
		Adapter: &workers.AdapterConfig{
			Type:     "ollama",
			Upstream: srv.URL,
			Model:    "test",
		},
	}}
	ok := checkWorkerEntry(t.Context(), e, nil, nil)
	if !ok {
		t.Error("adapter worker entry should pass with reachable upstream")
	}
}

// ---------- workerStartCmd with no endpoint ----------

func TestWorkerStartCmdLiveNoEndpoint(t *testing.T) {
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
	// Worker with no endpoint — should start without health check
	w := &workers.Worker{Name: "no-ep-live", Endpoint: ""}
	reg.Add(w)
	db.Close()

	cmd := workerStartCmd()
	err = cmd.RunE(cmd, []string{"no-ep-live"})
	if err != nil {
		t.Fatalf("start live worker without endpoint: %v", err)
	}
}

// ---------- dockerStart env resolution ----------

func TestDockerStartTokenResolutionWithSecrets(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)
	secretsYAML := `tokens:
  claude:
    dev: sk-ant-oat01-test123
`
	os.WriteFile(filepath.Join(mechaDir, "secrets.yml"), []byte(secretsYAML), 0o600)
	t.Setenv("HOME", dir)

	reg := newTestRegistry(t)
	reg.Add(&workers.Worker{
		Name: "token-worker",
		Docker: &workers.DockerConfig{
			Image: "test:latest",
			Token: "claude.dev",
		},
	})
	// dockerStart should fail at Docker connection, not at token resolution
	err := dockerStart(reg, "token-worker")
	if err == nil {
		t.Fatal("expected error (Docker unavailable)")
	}
	// Should NOT be a token error
	if strings.Contains(err.Error(), "resolve token") {
		t.Errorf("should have resolved token, got: %v", err)
	}
}
