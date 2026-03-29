package integration

import (
	"strings"
	"testing"
)

func TestCLI_Version(t *testing.T) {
	reg := tempRegistry(t)
	out, _, code := runMecha(t, reg, "version")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.HasPrefix(out, "mecha ") {
		t.Errorf("output = %q, want prefix 'mecha '", out)
	}
}

func TestCLI_WorkerAddFromFile(t *testing.T) {
	reg := tempRegistry(t)
	out, _, code := runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "added test-api (live)") {
		t.Errorf("output = %q, want 'added test-api (live)'", out)
	}
}

func TestCLI_WorkerAddFromDir(t *testing.T) {
	reg := tempRegistry(t)
	out, _, code := runMecha(t, reg, "worker", "add", fixtureDir())
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	// Should add unmanaged.yml and managed.yml and managed-full.yml (not invalid.yml)
	if !strings.Contains(out, "added") {
		t.Errorf("output should contain 'added', got %q", out)
	}
}

func TestCLI_WorkerLs(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))
	out, _, code := runMecha(t, reg, "worker", "ls")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "test-api") {
		t.Errorf("ls output missing worker name: %q", out)
	}
	if !strings.Contains(out, "offline") {
		t.Errorf("ls output missing state: %q", out)
	}
}

func TestCLI_WorkerStartStop(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))

	out, _, code := runMecha(t, reg, "worker", "start", "test-api")
	if code != 0 {
		t.Fatalf("start exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "started test-api") {
		t.Errorf("start output = %q", out)
	}

	out, _, code = runMecha(t, reg, "worker", "stop", "test-api")
	if code != 0 {
		t.Fatalf("stop exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "stopped test-api") {
		t.Errorf("stop output = %q", out)
	}

	out, _, code = runMecha(t, reg, "worker", "remove", "test-api")
	if code != 0 {
		t.Fatalf("remove exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "removed test-api") {
		t.Errorf("remove output = %q", out)
	}

	out, _, _ = runMecha(t, reg, "worker", "ls")
	if !strings.Contains(out, "no workers registered") {
		t.Errorf("ls after remove = %q", out)
	}
}

func TestCLI_WorkerLsShowsState(t *testing.T) {
	reg := tempRegistry(t)
	// Use unmanaged worker for state transition tests (no Docker needed).
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))

	out, _, _ := runMecha(t, reg, "worker", "ls")
	if !strings.Contains(out, "offline") {
		t.Errorf("ls after add should show offline: %q", out)
	}

	runMecha(t, reg, "worker", "start", "test-api")
	out, _, _ = runMecha(t, reg, "worker", "ls")
	// Unmanaged with unreachable endpoint → starts then transitions to error.
	if !strings.Contains(out, "error") && !strings.Contains(out, "online") {
		t.Errorf("ls after start should show error or online: %q", out)
	}

	runMecha(t, reg, "worker", "stop", "test-api")
	out, _, _ = runMecha(t, reg, "worker", "ls")
	if !strings.Contains(out, "offline") {
		t.Errorf("ls after stop should show offline: %q", out)
	}
}

func TestCLI_ConfigShow(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))
	out, _, code := runMecha(t, reg, "config", "test-api")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "name: test-api") {
		t.Errorf("config output missing name: %q", out)
	}
	if !strings.Contains(out, "endpoint:") {
		t.Errorf("config output missing endpoint: %q", out)
	}
}

func TestCLI_ConfigShowAll(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))
	runMecha(t, reg, "worker", "add", fixturePath("managed.yml"))
	out, _, code := runMecha(t, reg, "config")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "test-api") || !strings.Contains(out, "test-sandbox") {
		t.Errorf("config all output missing workers: %q", out)
	}
}
