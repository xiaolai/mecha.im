package integration

import (
	"strings"
	"testing"
)

func TestCLI_SSHWorkerAdd(t *testing.T) {
	reg := tempRegistry(t)
	out, _, code := runMecha(t, reg, "worker", "add", fixturePath("ssh-oneshot.yml"))
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "added test-ssh-oneshot (ssh)") {
		t.Errorf("output = %q, want 'added test-ssh-oneshot (ssh)'", out)
	}
}

func TestCLI_SSHWorkerLs(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("ssh-oneshot.yml"))
	out, _, code := runMecha(t, reg, "worker", "ls")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "test-ssh-oneshot") {
		t.Errorf("ls output missing worker: %q", out)
	}
	if !strings.Contains(out, "ssh") {
		t.Errorf("ls output missing type ssh: %q", out)
	}
	if !strings.Contains(out, "offline") {
		t.Errorf("ls output missing state offline: %q", out)
	}
}

func TestCLI_SSHWorkerAddBothModes(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("ssh-oneshot.yml"))
	out, _, code := runMecha(t, reg, "worker", "add", fixturePath("ssh-interactive.yml"))
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "added test-ssh-interactive (ssh)") {
		t.Errorf("output = %q", out)
	}

	out, _, _ = runMecha(t, reg, "worker", "ls")
	if !strings.Contains(out, "test-ssh-oneshot") || !strings.Contains(out, "test-ssh-interactive") {
		t.Errorf("ls should show both ssh workers: %q", out)
	}
}

func TestCLI_SSHWorkerRemove(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("ssh-oneshot.yml"))
	out, _, code := runMecha(t, reg, "worker", "remove", "test-ssh-oneshot")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "removed test-ssh-oneshot") {
		t.Errorf("output = %q", out)
	}
}

func TestCLI_SSHWorkerStartFailsUnreachable(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("ssh-oneshot.yml"))

	// Start should fail — 127.0.0.1 with user testuser is not reachable via SSH.
	_, stderr, code := runMecha(t, reg, "worker", "start", "test-ssh-oneshot")
	if code == 0 {
		t.Error("expected non-zero exit for unreachable SSH host")
	}
	if !strings.Contains(stderr, "ssh") {
		t.Errorf("stderr should mention ssh: %q", stderr)
	}
}

func TestCLI_SSHWorkerConfigShow(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("ssh-oneshot.yml"))
	out, _, code := runMecha(t, reg, "config", "test-ssh-oneshot")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "name: test-ssh-oneshot") {
		t.Errorf("config missing name: %q", out)
	}
	if !strings.Contains(out, "ssh:") {
		t.Errorf("config missing ssh section: %q", out)
	}
}
