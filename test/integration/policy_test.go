package integration

import (
	"strings"
	"testing"
)

func TestCLI_WorkerAddWithPolicy(t *testing.T) {
	reg := tempRegistry(t)
	out, _, code := runMecha(t, reg, "worker", "add", fixturePath("policy-worker.yml"))
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "added policy-test (live)") {
		t.Errorf("output = %q, want 'added policy-test (live)'", out)
	}
}

func TestCLI_ConfigShowPolicy(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("policy-worker.yml"))
	out, _, code := runMecha(t, reg, "config", "policy-test")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "policy:") {
		t.Errorf("config output missing policy: %q", out)
	}
	if !strings.Contains(out, "max_length") {
		t.Errorf("config output missing max_length: %q", out)
	}
	if !strings.Contains(out, "blocked") {
		t.Errorf("config output missing blocked: %q", out)
	}
}

func TestCLI_WorkerRemoveAndReaddWithPolicy(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("policy-worker.yml"))
	runMecha(t, reg, "worker", "remove", "policy-test")

	// Re-add should succeed (policy round-trips through SQLite)
	out, _, code := runMecha(t, reg, "worker", "add", fixturePath("policy-worker.yml"))
	if code != 0 {
		t.Fatalf("re-add exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "added policy-test") {
		t.Errorf("re-add output = %q", out)
	}

	// Config should still have policy after round-trip
	out, _, code = runMecha(t, reg, "config", "policy-test")
	if code != 0 {
		t.Fatalf("config exit code = %d, want 0", code)
	}
	if !strings.Contains(out, "policy:") {
		t.Errorf("policy lost after round-trip: %q", out)
	}
}
