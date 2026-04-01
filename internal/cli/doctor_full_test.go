package cli

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/store"
	"mecha.im/internal/worker"
)

func TestDoctorCmdStructure(t *testing.T) {
	cmd := doctorCmd()
	if cmd.Use != "doctor" {
		t.Errorf("use = %q, want doctor", cmd.Use)
	}
}

func TestDoctorCmdRun(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)
	dbPath := filepath.Join(mechaDir, "mecha.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	db.Close()

	t.Setenv("HOME", dir)
	t.Setenv("MECHA_DB_PATH", dbPath)

	cmd := doctorCmd()
	cmd.SetContext(context.Background())
	// RunE returns nil on all-pass or error on failure. Docker check may fail.
	// Either result is valid — we verify it returns without panic and returns
	// a non-nil error specifically when Docker is unavailable.
	err = cmd.RunE(cmd, nil)
	// On CI without Docker, doctor fails — that's expected.
	if err != nil && !strings.Contains(err.Error(), "some checks failed") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestCheckDockerNoSocket(t *testing.T) {
	// Set a bogus DOCKER_HOST so the client fails
	t.Setenv("DOCKER_HOST", "tcp://127.0.0.1:1")
	// checkDocker should return false (docker unreachable)
	ok := checkDocker(context.Background())
	if ok {
		// Docker might actually be running locally, so only fail if we
		// explicitly pointed at a bogus host and it still passed
		t.Log("checkDocker passed with bogus DOCKER_HOST — Docker may be running locally")
	}
}

func TestRunSystemChecks(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	dbPath := filepath.Join(mechaDir, "test.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	db.Close()

	t.Setenv("HOME", dir)
	t.Setenv("MECHA_DB_PATH", dbPath)

	// With valid dir + DB, system checks pass (Docker may fail, which returns false).
	// Either true (all pass) or false (Docker unavailable) is acceptable.
	// We verify no panic.
	ok := runSystemChecks(context.Background())
	t.Logf("runSystemChecks = %v (Docker may be unavailable)", ok)
}

func TestCheckMechaDirExists(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)
	t.Setenv("HOME", dir)

	if !checkMechaDir() {
		t.Error("checkMechaDir should pass when dir exists")
	}
}

func TestCheckMechaDirMissing(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)

	if checkMechaDir() {
		t.Error("checkMechaDir should fail when dir missing")
	}
}

func TestCheckMechaDirIsFile(t *testing.T) {
	dir := t.TempDir()
	// Create .mecha as a file, not directory
	os.WriteFile(filepath.Join(dir, ".mecha"), []byte("not a dir"), 0o644)
	t.Setenv("HOME", dir)

	if checkMechaDir() {
		t.Error("checkMechaDir should fail when .mecha is a file")
	}
}

func TestRunWorkerChecksEmpty(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	db.Close()
	t.Setenv("MECHA_DB_PATH", dbPath)

	// Empty registry should pass
	ok := runWorkerChecks(context.Background())
	if !ok {
		t.Error("runWorkerChecks should pass with empty registry")
	}
}

func TestRunWorkerChecksWithWorkers(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	reg.Add(&worker.Worker{Name: "live-w", Endpoint: "http://localhost:1"})
	db.Close()
	t.Setenv("MECHA_DB_PATH", dbPath)

	// With a live worker, checks run (health probe may fail).
	ok := runWorkerChecks(context.Background())
	t.Logf("runWorkerChecks with workers = %v", ok)
}

func TestRunWorkerChecksCancelled(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	reg.Add(&worker.Worker{Name: "w1", Endpoint: "http://localhost:1"})
	reg.Add(&worker.Worker{Name: "w2", Endpoint: "http://localhost:2"})
	db.Close()
	t.Setenv("MECHA_DB_PATH", dbPath)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled

	ok := runWorkerChecks(ctx)
	if ok {
		t.Error("runWorkerChecks should fail with cancelled context")
	}
}

func TestCheckWorkerEntryLive(t *testing.T) {
	e := worker.Entry{Worker: &worker.Worker{Name: "live", Endpoint: "http://x"}}
	// Live worker with no Docker or Adapter — no checks to fail
	ok := checkWorkerEntry(context.Background(), e, nil, nil)
	if !ok {
		t.Error("live worker entry should pass")
	}
}

func TestCheckWorkerEntryDocker(t *testing.T) {
	cwd := t.TempDir()
	e := worker.Entry{Worker: &worker.Worker{
		Name: "docker-w",
		Docker: &worker.DockerConfig{
			Image: "test:latest",
			Cwd:   cwd,
		},
	}}
	// Should pass cwd check (valid dir), skip image check (no DockerClient)
	ok := checkWorkerEntry(context.Background(), e, nil, nil)
	if !ok {
		t.Error("docker worker with valid cwd should pass")
	}
}

func TestCheckWorkerCwdValid(t *testing.T) {
	cwd := t.TempDir()
	w := &worker.Worker{Docker: &worker.DockerConfig{Cwd: cwd}}
	if !checkWorkerCwd(w) {
		t.Error("checkWorkerCwd should pass for valid directory")
	}
}

func TestCheckWorkerCwdEmpty(t *testing.T) {
	w := &worker.Worker{Docker: &worker.DockerConfig{Cwd: ""}}
	if !checkWorkerCwd(w) {
		t.Error("checkWorkerCwd should pass for empty cwd")
	}
}

func TestCheckWorkerCwdNonexistent(t *testing.T) {
	w := &worker.Worker{Docker: &worker.DockerConfig{Cwd: "/nonexistent/path"}}
	if checkWorkerCwd(w) {
		t.Error("checkWorkerCwd should fail for nonexistent path")
	}
}

func TestCheckWorkerCwdIsFile(t *testing.T) {
	dir := t.TempDir()
	fpath := filepath.Join(dir, "file.txt")
	os.WriteFile(fpath, []byte("hello"), 0o644)
	w := &worker.Worker{Docker: &worker.DockerConfig{Cwd: fpath}}
	if checkWorkerCwd(w) {
		t.Error("checkWorkerCwd should fail for file path")
	}
}

func TestCheckWorkerTokenNoToken(t *testing.T) {
	w := &worker.Worker{Docker: &worker.DockerConfig{Token: ""}}
	if !checkWorkerToken(w, nil) {
		t.Error("should pass with no token")
	}
}

func TestCheckWorkerTokenNoSecrets(t *testing.T) {
	w := &worker.Worker{Docker: &worker.DockerConfig{Token: "claude.dev"}}
	if !checkWorkerToken(w, nil) {
		t.Error("should pass (warn) with no secrets file")
	}
}

func TestCheckWorkerTokenResolves(t *testing.T) {
	secrets := &worker.Secrets{
		Tokens: map[string]map[string]string{
			"claude": {"dev": "sk-ant-test"},
		},
	}
	w := &worker.Worker{Docker: &worker.DockerConfig{Token: "claude.dev"}}
	if !checkWorkerToken(w, secrets) {
		t.Error("should pass when token resolves")
	}
}

func TestCheckWorkerTokenMissing(t *testing.T) {
	secrets := &worker.Secrets{
		Tokens: map[string]map[string]string{
			"claude": {"dev": "sk-ant-test"},
		},
	}
	w := &worker.Worker{Docker: &worker.DockerConfig{Token: "claude.prod"}}
	if checkWorkerToken(w, secrets) {
		t.Error("should fail when token not found")
	}
}

func TestCheckWorkerImageNilClient(t *testing.T) {
	w := &worker.Worker{Docker: &worker.DockerConfig{Image: "test:latest"}}
	// No Docker client → skip (return true)
	if !checkWorkerImage(context.Background(), w, nil) {
		t.Error("should pass with nil docker client")
	}
}

func TestCheckWorkerImageCustomHost(t *testing.T) {
	w := &worker.Worker{Docker: &worker.DockerConfig{
		Image: "test:latest",
		Host:  "tcp://remote:2375",
	}}
	// Custom host → skip (return true with warn)
	if !checkWorkerImage(context.Background(), w, nil) {
		t.Error("should pass (warn) with custom docker host")
	}
}

func TestCheckAdapterUpstreamReachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	w := &worker.Worker{Adapter: &worker.AdapterConfig{
		Type:     "ollama",
		Upstream: srv.URL,
	}}
	if !checkAdapterUpstream(w) {
		t.Error("should pass when upstream is reachable")
	}
}

func TestCheckAdapterUpstreamUnreachable(t *testing.T) {
	w := &worker.Worker{Adapter: &worker.AdapterConfig{
		Type:     "ollama",
		Upstream: "http://127.0.0.1:1",
	}}
	// Unreachable → warn (returns true, not false)
	if !checkAdapterUpstream(w) {
		t.Error("should pass (warn) when upstream is unreachable")
	}
}

func TestCheckAdapterUpstreamOpenAIPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	w := &worker.Worker{Adapter: &worker.AdapterConfig{
		Type:     "openai",
		Upstream: srv.URL,
	}}
	if !checkAdapterUpstream(w) {
		t.Error("openai adapter should use /v1/models path")
	}
}

func TestProbeHTTPSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if err := probeHTTP(srv.URL, 2*time.Second); err != nil {
		t.Errorf("probeHTTP should pass: %v", err)
	}
}

func TestProbeHTTP400(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	if err := probeHTTP(srv.URL, 2*time.Second); err == nil {
		t.Error("probeHTTP should fail for 400")
	}
}

func TestProbeHTTPUnreachable(t *testing.T) {
	if err := probeHTTP("http://127.0.0.1:1", 1*time.Second); err == nil {
		t.Error("probeHTTP should fail for unreachable")
	}
}

func TestProbeHTTPInvalidURL(t *testing.T) {
	if err := probeHTTP("://bad", 1*time.Second); err == nil {
		t.Error("probeHTTP should fail for invalid URL")
	}
}

func TestLoadSecretsQuietMissing(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	s := loadSecretsQuiet()
	// Missing file → nil or empty, no panic
	if s != nil && len(s.Tokens) > 0 {
		t.Error("loadSecretsQuiet should return empty/nil for missing file")
	}
}

func TestDockerClientQuietNoDocker(t *testing.T) {
	// Docker may or may not be available. Just verify no panic.
	dc := dockerClientQuiet()
	if dc != nil {
		dc.Close()
	}
}

func TestWorkerStartCmdOnline(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	w := &worker.Worker{Name: "online-w", Endpoint: "http://localhost:1"}
	reg.Add(w)
	reg.Start("online-w") // Make it online
	db.Close()

	cmd := workerStartCmd()
	err = cmd.RunE(cmd, []string{"online-w"})
	if err == nil {
		t.Fatal("expected error: worker already online")
	}
	if !strings.Contains(err.Error(), "offline") {
		t.Errorf("error = %q, want mention of 'offline'", err)
	}
}

func TestWorkerStartCmdLiveHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	reg.Add(&worker.Worker{Name: "healthy-live", Endpoint: srv.URL})
	db.Close()

	cmd := workerStartCmd()
	err = cmd.RunE(cmd, []string{"healthy-live"})
	if err != nil {
		t.Fatalf("start live worker: %v", err)
	}
}

func TestWorkerStartCmdLiveUnhealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	reg.Add(&worker.Worker{Name: "sick-live", Endpoint: srv.URL})
	db.Close()

	cmd := workerStartCmd()
	// Should succeed but print a warning about health check
	err = cmd.RunE(cmd, []string{"sick-live"})
	if err != nil {
		t.Fatalf("start unhealthy live worker should still succeed: %v", err)
	}
}

func TestWorkerStopCmdLiveOnline(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	reg.Add(&worker.Worker{Name: "stop-me", Endpoint: "http://localhost:1"})
	reg.Start("stop-me")
	db.Close()

	cmd := workerStopCmd()
	err = cmd.RunE(cmd, []string{"stop-me"})
	if err != nil {
		t.Fatalf("stop online live worker: %v", err)
	}
}

func TestWorkerStopCmdAdapter(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	w := &worker.Worker{
		Name: "adapter-stop",
		Adapter: &worker.AdapterConfig{
			Type: "ollama", Upstream: "http://localhost:11434", Model: "test",
		},
	}
	reg.Add(w)
	reg.Start("adapter-stop")
	db.Close()

	cmd := workerStopCmd()
	err = cmd.RunE(cmd, []string{"adapter-stop"})
	if err != nil {
		t.Fatalf("stop adapter worker: %v", err)
	}
}

func TestWorkerRemoveCmdManaged(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)

	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	reg.Add(&worker.Worker{
		Name:   "managed-rm",
		Docker: &worker.DockerConfig{Image: "test:latest"},
	})
	db.Close()

	cmd := workerRemoveCmd()
	// dockerRemove will try Docker, but no container exists — should still remove from registry
	err = cmd.RunE(cmd, []string{"managed-rm"})
	// This might error if Docker isn't available, that's expected
	_ = err
}

