package integration

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/workers"
)

const testImage = "mecha-worker:latest"

// waitForHealth polls the /health endpoint until 200 or timeout.
func waitForHealth(endpoint string, timeout time.Duration) bool {
	deadline := time.After(timeout)
	for {
		select {
		case <-deadline:
			return false
		default:
			resp, err := http.Get(endpoint + "/health")
			if err == nil && resp.StatusCode == 200 {
				resp.Body.Close()
				return true
			}
			time.Sleep(2 * time.Second)
		}
	}
}

// containerLogs returns combined stdout/stderr from a Docker container.
func containerLogs(containerID string) string {
	out, _ := exec.Command("docker", "logs", containerID).CombinedOutput()
	return string(out)
}

// --- Test 1: Runtime CLI Install ---

func TestRuntime_CLIsInstalled(t *testing.T) {
	skipIfNoDocker(t)
	skipIfNoImage(t, testImage)

	cli, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}
	defer cli.Close()

	ctx := context.Background()
	cfg := workers.ContainerCfg{
		Name:   "mecha-test-runtime-cli",
		Image:  testImage,
		Env:    map[string]string{"CLAUDE_MODEL": "test"},
		Labels: map[string]string{"mecha.test": "true"},
		// Don't set User — let the container use its Dockerfile USER (worker).
	// Host UID override is only needed for workspace bind mounts.
	}

	id, err := cli.Create(ctx, cfg)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer cli.Remove(ctx, id)

	if err := cli.Start(ctx, id); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer cli.Stop(ctx, id, 10*time.Second)

	endpoint, err := cli.Endpoint(ctx, id)
	if err != nil {
		t.Fatalf("endpoint: %v", err)
	}

	// Wait for container to be healthy (CLIs installed + server booted)
	if !waitForHealth(endpoint, 90*time.Second) {
		logs := containerLogs(id)
		t.Fatalf("container never became healthy.\nLogs:\n%s", logs)
	}

	// Verify CLIs are installed by exec'ing into container
	out, err := exec.Command("docker", "exec", id, "claude", "--version").CombinedOutput()
	if err != nil {
		t.Errorf("claude --version failed: %v\nOutput: %s", err, out)
	} else {
		t.Logf("claude version: %s", strings.TrimSpace(string(out)))
	}

	out, err = exec.Command("docker", "exec", id, "codex", "--version").CombinedOutput()
	if err != nil {
		t.Errorf("codex --version failed: %v\nOutput: %s", err, out)
	} else {
		t.Logf("codex version: %s", strings.TrimSpace(string(out)))
	}
}

// --- Test 2: Settings File ---

func TestRuntime_SettingsFile(t *testing.T) {
	skipIfNoDocker(t)
	skipIfNoImage(t, testImage)

	cli, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}
	defer cli.Close()

	ctx := context.Background()
	cfg := workers.ContainerCfg{
		Name:   "mecha-test-runtime-settings",
		Image:  testImage,
		Env:    map[string]string{"CLAUDE_MODEL": "test"},
		Labels: map[string]string{"mecha.test": "true"},
		// Don't set User — let the container use its Dockerfile USER (worker).
	// Host UID override is only needed for workspace bind mounts.
	}

	id, err := cli.Create(ctx, cfg)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer cli.Remove(ctx, id)
	if err := cli.Start(ctx, id); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer cli.Stop(ctx, id, 10*time.Second)

	endpoint, _ := cli.Endpoint(ctx, id)
	if !waitForHealth(endpoint, 90*time.Second) {
		t.Fatal("container never became healthy")
	}

	out, err := exec.Command("docker", "exec", id, "cat", "/home/worker/.claude/settings.json").CombinedOutput()
	if err != nil {
		t.Fatalf("read settings: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "enableAllProjectMcpServers") {
		t.Errorf("settings missing enableAllProjectMcpServers:\n%s", out)
	}
}

// --- Test 3: Codex MCP Detection ---

func TestRuntime_CodexMCPNoAuth(t *testing.T) {
	skipIfNoDocker(t)
	skipIfNoImage(t, testImage)

	cli, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}
	defer cli.Close()

	ctx := context.Background()

	// CODEX_MCP=true without any auth → should exit 1
	cfg := workers.ContainerCfg{
		Name:  "mecha-test-mcp-noauth",
		Image: testImage,
		Env: map[string]string{
			"CLAUDE_MODEL": "test",
			"CODEX_MCP":    "true",
		},
		Labels: map[string]string{"mecha.test": "true"},
		// Don't set User — let the container use its Dockerfile USER (worker).
	// Host UID override is only needed for workspace bind mounts.
	}

	id, err := cli.Create(ctx, cfg)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer cli.Remove(ctx, id)

	if err := cli.Start(ctx, id); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer cli.Stop(ctx, id, 10*time.Second)

	// Wait for container to exit (should fail fast)
	deadline := time.After(90 * time.Second)
	for {
		select {
		case <-deadline:
			logs := containerLogs(id)
			t.Fatalf("container did not exit as expected.\nLogs:\n%s", logs)
		default:
			out, err := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", id).CombinedOutput()
			if err == nil && strings.TrimSpace(string(out)) == "false" {
				logs := containerLogs(id)
				if !strings.Contains(logs, "CODEX_MCP=true but no auth") {
					t.Errorf("expected 'no auth' error in logs:\n%s", logs)
				} else {
					t.Log("container correctly exited with auth error")
				}
				return
			}
			time.Sleep(2 * time.Second)
		}
	}
}

func TestRuntime_CodexMCPWithAPIKey(t *testing.T) {
	skipIfNoDocker(t)
	skipIfNoImage(t, testImage)

	cli, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}
	defer cli.Close()

	ctx := context.Background()
	cfg := workers.ContainerCfg{
		Name:  "mecha-test-mcp-apikey",
		Image: testImage,
		Env: map[string]string{
			"CLAUDE_MODEL":  "test",
			"CODEX_API_KEY": "sk-test-fake-key",
		},
		Labels: map[string]string{"mecha.test": "true"},
		// Don't set User — let the container use its Dockerfile USER (worker).
	// Host UID override is only needed for workspace bind mounts.
	}

	id, err := cli.Create(ctx, cfg)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer cli.Remove(ctx, id)
	if err := cli.Start(ctx, id); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer cli.Stop(ctx, id, 10*time.Second)

	endpoint, _ := cli.Endpoint(ctx, id)
	if !waitForHealth(endpoint, 90*time.Second) {
		logs := containerLogs(id)
		t.Fatalf("container never became healthy.\nLogs:\n%s", logs)
	}

	logs := containerLogs(id)
	if !strings.Contains(logs, "codex MCP enabled via API key") {
		t.Errorf("expected 'MCP enabled via API key' in logs:\n%s", logs)
	}
}

func TestRuntime_NoCodexMCPByDefault(t *testing.T) {
	skipIfNoDocker(t)
	skipIfNoImage(t, testImage)

	cli, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}
	defer cli.Close()

	ctx := context.Background()
	cfg := workers.ContainerCfg{
		Name:   "mecha-test-no-mcp",
		Image:  testImage,
		Env:    map[string]string{"CLAUDE_MODEL": "test"},
		Labels: map[string]string{"mecha.test": "true"},
		// Don't set User — let the container use its Dockerfile USER (worker).
	// Host UID override is only needed for workspace bind mounts.
	}

	id, err := cli.Create(ctx, cfg)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer cli.Remove(ctx, id)
	if err := cli.Start(ctx, id); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer cli.Stop(ctx, id, 10*time.Second)

	endpoint, _ := cli.Endpoint(ctx, id)
	if !waitForHealth(endpoint, 90*time.Second) {
		t.Fatal("container never became healthy")
	}

	logs := containerLogs(id)
	if strings.Contains(logs, "codex MCP enabled") {
		t.Errorf("MCP should not be enabled without credentials:\n%s", logs)
	}
}

// --- Test 4: Plugin Env Vars ---

func TestRuntime_PluginEnvVars(t *testing.T) {
	skipIfNoDocker(t)
	skipIfNoImage(t, testImage)

	cli, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}
	defer cli.Close()

	ctx := context.Background()
	cfg := workers.ContainerCfg{
		Name:  "mecha-test-plugins",
		Image: testImage,
		Env: map[string]string{
			"CLAUDE_MODEL":   "test",
			"CLAUDE_PLUGINS": "nonexistent-plugin",
		},
		Labels: map[string]string{"mecha.test": "true"},
		// Don't set User — let the container use its Dockerfile USER (worker).
	// Host UID override is only needed for workspace bind mounts.
	}

	id, err := cli.Create(ctx, cfg)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer cli.Remove(ctx, id)
	if err := cli.Start(ctx, id); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer cli.Stop(ctx, id, 10*time.Second)

	endpoint, _ := cli.Endpoint(ctx, id)
	// Wait for container to become healthy (CLIs installed) or exit
	// Plugin install happens after CLI install, so we need the full boot
	waitForHealth(endpoint, 90*time.Second)
	// Give plugin install step a few extra seconds
	time.Sleep(10 * time.Second)

	logs := containerLogs(id)
	if !strings.Contains(logs, "installing: nonexistent-plugin") && !strings.Contains(logs, "installing plugins") {
		t.Errorf("expected plugin install attempt in logs:\n%s", logs)
	}
}

// --- Test 5: Credential Mount via CLI ---

func TestRuntime_DualCredentialMount(t *testing.T) {
	skipIfNoDocker(t)
	skipIfNoImage(t, testImage)

	home, _ := os.UserHomeDir()
	for _, dir := range []string{".claude", ".codex"} {
		if _, err := os.Stat(filepath.Join(home, dir)); err != nil {
			t.Skipf("%s/%s not found on host", home, dir)
		}
	}

	// Use Docker SDK directly — the CLI's health timeout is too short for runtime install.
	dc := &workers.DockerConfig{
		Image:       testImage,
		Credentials: []string{"claude", "codex"},
	}
	mounts, err := workers.BuildContainerMounts(dc)
	if err != nil {
		t.Fatal(err)
	}

	cli, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}
	defer cli.Close()

	ctx := context.Background()
	cfg := workers.ContainerCfg{
		Name:   "mecha-test-cred-mount",
		Image:  testImage,
		Env:    map[string]string{"CLAUDE_MODEL": "test"},
		Labels: map[string]string{"mecha.test": "true"},
		Mounts: mounts,
		// Don't set User — let the container use its Dockerfile USER (worker).
	}

	id, err := cli.Create(ctx, cfg)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer cli.Remove(ctx, id)
	if err := cli.Start(ctx, id); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer cli.Stop(ctx, id, 10*time.Second)

	// Verify mounts by inspecting the container
	inspectOut, err := exec.Command("docker", "inspect",
		"-f", "{{range .Mounts}}{{.Destination}} {{.RW}}\n{{end}}", id).CombinedOutput()
	if err != nil {
		t.Fatalf("inspect: %v\n%s", err, inspectOut)
	}

	mountStr := string(inspectOut)
	if !strings.Contains(mountStr, "/home/worker/.claude false") {
		t.Errorf(".claude mount missing or not read-only:\n%s", mountStr)
	}
	if !strings.Contains(mountStr, "/home/worker/.codex false") {
		t.Errorf(".codex mount missing or not read-only:\n%s", mountStr)
	}
	t.Logf("mounts verified:\n%s", mountStr)
}

// --- Test 6: Health During Install Phase ---

func TestRuntime_HealthDuringInstall(t *testing.T) {
	skipIfNoDocker(t)
	skipIfNoImage(t, testImage)

	cli, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}
	defer cli.Close()

	ctx := context.Background()
	cfg := workers.ContainerCfg{
		Name:   "mecha-test-health-phase",
		Image:  testImage,
		Env:    map[string]string{"CLAUDE_MODEL": "test"},
		Labels: map[string]string{"mecha.test": "true"},
		// Don't set User — let the container use its Dockerfile USER (worker).
	// Host UID override is only needed for workspace bind mounts.
	}

	id, err := cli.Create(ctx, cfg)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer cli.Remove(ctx, id)
	if err := cli.Start(ctx, id); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer cli.Stop(ctx, id, 10*time.Second)

	endpoint, err := cli.Endpoint(ctx, id)
	if err != nil {
		t.Fatalf("endpoint: %v", err)
	}

	// Immediately after start, health should either fail or not respond
	// (CLI install is in progress)
	resp, err := http.Get(endpoint + "/health")
	earlyHealthy := err == nil && resp.StatusCode == 200
	if resp != nil {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
	t.Logf("early health check: reachable=%v, healthy=%v", err == nil, earlyHealthy)

	// Eventually it should become healthy
	if !waitForHealth(endpoint, 90*time.Second) {
		logs := containerLogs(id)
		t.Fatalf("container never became healthy.\nLogs:\n%s", logs)
	}
	t.Log("container eventually healthy after CLI install")
}
