package integration

import (
	"strings"
	"testing"
)

func TestSerialize_UnmanagedWorker(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))

	out, _, code := runMecha(t, reg, "config", "test-api")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	for _, want := range []string{"name: test-api", "endpoint:", "timeout: 5m"} {
		if !strings.Contains(out, want) {
			t.Errorf("config missing %q in:\n%s", want, out)
		}
	}
}

func TestSerialize_ManagedWorker(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("managed.yml"))

	out, _, code := runMecha(t, reg, "config", "test-sandbox")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	for _, want := range []string{
		"name: test-sandbox",
		"image: ghcr.io/test/worker:v1.0.0",
		"lifecycle: disposable",
		"port: 8080",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("config missing %q in:\n%s", want, out)
		}
	}
}

func TestSerialize_ManagedFullRoundTrip(t *testing.T) {
	t.Setenv("TEST_PROXY_KEY", "dummy")
	reg := tempRegistry(t)
	// managed-full.yml uses ${TEST_PROXY_KEY} in docker.host is not set,
	// but proxy.key should stay as env var reference.
	runMecha(t, reg, "worker", "add", fixturePath("managed-full.yml"))

	out, _, code := runMecha(t, reg, "config", "test-full")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	for _, want := range []string{
		"name: test-full",
		"lifecycle: persistent",
		"port: 9090",
		"cpu: 4",
		"memory: 8G",
		"pids: 256",
		"target: https://api.example.com",
		"key: ${TEST_PROXY_KEY}",
		"api.example.com",
		"timeout: 15m",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("config missing %q in:\n%s", want, out)
		}
	}
}

func TestSerialize_DefaultsApplied(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("managed.yml"))

	out, _, code := runMecha(t, reg, "config", "test-sandbox")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	// These should be applied as defaults.
	if !strings.Contains(out, "lifecycle: disposable") {
		t.Errorf("default lifecycle not applied:\n%s", out)
	}
	if !strings.Contains(out, "port: 8080") {
		t.Errorf("default port not applied:\n%s", out)
	}
	if !strings.Contains(out, "timeout: 10m") {
		t.Errorf("default timeout not applied:\n%s", out)
	}
}
