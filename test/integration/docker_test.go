package integration

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/worker"
)

func skipIfNoDocker(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("docker not available")
	}
	cli, err := worker.NewDockerClient("")
	if err != nil {
		t.Skipf("docker client: %v", err)
	}
	cli.Close()
}

func TestDocker_ClientConnect(t *testing.T) {
	skipIfNoDocker(t)
	cli, err := worker.NewDockerClient("")
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer cli.Close()
}

func TestDocker_CreateStartStop(t *testing.T) {
	skipIfNoDocker(t)
	cli, err := worker.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}
	defer cli.Close()

	ctx := context.Background()
	cfg := worker.ContainerCfg{
		Name:   "mecha-test-integration",
		Image:  "mecha-worker-claude:latest",
		Env:    map[string]string{"CLAUDE_MODEL": "test"},
		Labels: map[string]string{"mecha.test": "true"},
		User:   worker.CurrentUser(),
	}

	id, err := cli.Create(ctx, cfg)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer cli.Remove(ctx, id)

	if err := cli.Start(ctx, id); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer cli.Stop(ctx, id, 5*time.Second)

	endpoint, err := cli.Endpoint(ctx, id)
	if err != nil {
		t.Fatalf("endpoint: %v", err)
	}
	if !strings.HasPrefix(endpoint, "http://127.0.0.1:") {
		t.Errorf("endpoint = %q", endpoint)
	}

	// Wait for health
	var healthy bool
	for i := 0; i < 10; i++ {
		time.Sleep(1 * time.Second)
		resp, err := http.Get(endpoint + "/health")
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			healthy = true
			break
		}
	}
	if !healthy {
		t.Fatal("health check never passed")
	}
}

func TestDocker_CLILifecycle(t *testing.T) {
	skipIfNoDocker(t)

	reg := tempRegistry(t)
	yaml := `name: docker-e2e
docker:
  image: mecha-worker-claude:latest
  env:
    CLAUDE_MODEL: test
  lifecycle: persistent
timeout: 5m
`
	yamlPath := t.TempDir() + "/docker-e2e.yml"
	if err := writeFile(yamlPath, yaml); err != nil {
		t.Fatal(err)
	}

	// Add
	out, _, code := runMecha(t, reg, "worker", "add", yamlPath)
	if code != 0 {
		t.Fatalf("add failed: %s", out)
	}

	// Ls — should be offline
	out, _, _ = runMecha(t, reg, "worker", "ls")
	if !strings.Contains(out, "offline") {
		t.Errorf("expected offline: %s", out)
	}

	// Start — creates container
	out, stderr, code := runMecha(t, reg, "worker", "start", "docker-e2e")
	if code != 0 {
		t.Fatalf("start failed (code %d): stdout=%s stderr=%s", code, out, stderr)
	}
	if !strings.Contains(out, "started") {
		t.Errorf("expected 'started': %s", out)
	}

	// Ls — should be online with endpoint
	out, _, _ = runMecha(t, reg, "worker", "ls")
	if !strings.Contains(out, "online") {
		t.Errorf("expected online: %s", out)
	}
	if !strings.Contains(out, "127.0.0.1") {
		t.Errorf("expected endpoint: %s", out)
	}

	// Stop
	out, _, code = runMecha(t, reg, "worker", "stop", "docker-e2e")
	if code != 0 {
		t.Fatalf("stop failed: %s", out)
	}

	// Ls — should be offline
	out, _, _ = runMecha(t, reg, "worker", "ls")
	if !strings.Contains(out, "offline") {
		t.Errorf("expected offline after stop: %s", out)
	}

	// Remove — cleans up container
	out, _, code = runMecha(t, reg, "worker", "remove", "docker-e2e")
	if code != 0 {
		t.Fatalf("remove failed: %s", out)
	}
}

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}
