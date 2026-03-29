package integration

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeWorkerYAML(t *testing.T, name, endpoint string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name+".yml")
	content := fmt.Sprintf("name: %s\nendpoint: %s\ntimeout: 5m\n", name, endpoint)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestHealth_OnlineWorkerHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()

	reg := tempRegistry(t)
	yaml := writeWorkerYAML(t, "healthy", srv.URL)
	runMecha(t, reg, "worker", "add", yaml)
	runMecha(t, reg, "worker", "start", "healthy")

	out, _, code := runMecha(t, reg, "worker", "ls")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	if !strings.Contains(out, "ok") {
		t.Errorf("ls should show 'ok' for healthy worker: %q", out)
	}
}

func TestHealth_OnlineWorkerUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	reg := tempRegistry(t)
	yaml := writeWorkerYAML(t, "flaky", srv.URL)
	runMecha(t, reg, "worker", "add", yaml)
	runMecha(t, reg, "worker", "start", "flaky")

	// Shut down the server to simulate failure.
	srv.Close()

	out, _, code := runMecha(t, reg, "worker", "ls")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	if !strings.Contains(out, "unreachable") {
		t.Errorf("ls should show 'unreachable' for down worker: %q", out)
	}
}

func TestHealth_OfflineWorkerSkipped(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))

	out, _, code := runMecha(t, reg, "worker", "ls")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	// Offline workers should show "-" in health column, not "unreachable".
	lines := strings.Split(out, "\n")
	for _, line := range lines {
		if strings.Contains(line, "test-api") {
			fields := strings.Fields(line)
			health := fields[len(fields)-1]
			if health != "-" {
				t.Errorf("offline worker health = %q, want '-'", health)
			}
		}
	}
}

func TestHealth_StartProbesLiveWorker(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()

	reg := tempRegistry(t)
	yaml := writeWorkerYAML(t, "probe-test", srv.URL)
	runMecha(t, reg, "worker", "add", yaml)

	out, _, code := runMecha(t, reg, "worker", "start", "probe-test")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	if !strings.Contains(out, "started probe-test") {
		t.Errorf("start output = %q", out)
	}
}

func TestHealth_StartWarnsOnUnhealthy(t *testing.T) {
	// Use a port that's not listening.
	reg := tempRegistry(t)
	yaml := writeWorkerYAML(t, "dead", "http://127.0.0.1:1")
	runMecha(t, reg, "worker", "add", yaml)

	out, _, code := runMecha(t, reg, "worker", "start", "dead")
	if code != 0 {
		t.Fatalf("exit code = %d (start should succeed with warning)", code)
	}
	if !strings.Contains(out, "warning") {
		t.Errorf("start should warn about unhealthy: %q", out)
	}
}
