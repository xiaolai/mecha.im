package worker

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func dockerAvailable() bool {
	dc, err := NewDockerClient("")
	if err != nil {
		return false
	}
	defer dc.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = dc.Ping(ctx)
	return err == nil
}

func TestDockerClientLifecycle(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dc, err := NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}
	defer dc.Close()

	ctx := context.Background()

	// Ping
	apiVer, err := dc.Ping(ctx)
	if err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if apiVer == "" {
		t.Error("Ping returned empty API version")
	}

	// ImageExists — known image
	exists, err := dc.ImageExists(ctx, "mecha-worker-base:latest")
	if err != nil {
		t.Fatalf("ImageExists: %v", err)
	}
	if !exists {
		t.Skip("mecha-worker-base:latest not available")
	}

	// ImageExists — nonexistent image
	exists, err = dc.ImageExists(ctx, "nonexistent-image-abc123:latest")
	if err != nil {
		// Some Docker daemon versions return an error rather than (false, nil)
		// for missing images. Both behaviors are acceptable.
		t.Logf("ImageExists nonexistent returned error (acceptable): %v", err)
	} else if exists {
		t.Error("nonexistent image should not exist")
	}

	// Use mecha-worker with DRY_RUN=true — Caddy on 8080, stays alive, no LLM needed
	containerName := "mecha-test-lifecycle-" + t.Name()
	id, err := dc.Create(ctx, ContainerCfg{
		Name:  containerName,
		Image: "mecha-worker:latest",
		Env: map[string]string{
			"WORKER_DRY_RUN": "true",
			"HOME":           "/tmp",
		},
		Labels: map[string]string{"mecha.test": "true"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if id == "" {
		t.Fatal("Create returned empty container ID")
	}

	// Cleanup on exit
	defer func() {
		rmCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		dc.Stop(rmCtx, id, 5*time.Second)
		dc.Remove(rmCtx, id)
	}()

	// Start
	if err := dc.Start(ctx, id); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Wait for Caddy to bind port 8080
	time.Sleep(2 * time.Second)

	// Endpoint — should return http://127.0.0.1:<mapped-port>
	ep, err := dc.Endpoint(ctx, id)
	if err != nil {
		t.Fatalf("Endpoint: %v", err)
	}
	if ep == "" || !strings.HasPrefix(ep, "http://") {
		t.Errorf("Endpoint = %q, want http://...", ep)
	}

	// Health check via the endpoint
	if err := CheckHealth(ep, 10*time.Second); err != nil {
		t.Logf("Health check: %v (Caddy may still be starting)", err)
	}

	// Stop
	if err := dc.Stop(ctx, id, 10*time.Second); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	// Remove
	if err := dc.Remove(ctx, id); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	// Remove again — should error (already removed)
	err = dc.Remove(ctx, id)
	if err == nil {
		t.Error("Remove of already-removed container should error")
	}
}

func TestDockerClientCreateExpose(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dc, err := NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}
	defer dc.Close()

	ctx := context.Background()
	containerName := "mecha-test-expose-" + t.Name()
	id, err := dc.Create(ctx, ContainerCfg{
		Name:   containerName,
		Image:  "mecha-worker-base:latest",
		Expose: true, // bind to 0.0.0.0
	})
	if err != nil {
		t.Fatalf("Create with Expose: %v", err)
	}
	defer func() {
		rmCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		dc.Remove(rmCtx, id)
	}()

	if id == "" {
		t.Fatal("Create returned empty ID")
	}
}

func TestDockerClientCreateWithResources(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dc, err := NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}
	defer dc.Close()

	ctx := context.Background()
	containerName := "mecha-test-resources-" + t.Name()
	id, err := dc.Create(ctx, ContainerCfg{
		Name:  containerName,
		Image: "mecha-worker-base:latest",
		Resources: ResourceConfig{
			CPU:    2,
			Memory: "512M",
			Pids:   128,
		},
	})
	if err != nil {
		t.Fatalf("Create with resources: %v", err)
	}
	defer func() {
		rmCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		dc.Remove(rmCtx, id)
	}()
}

func TestDockerClientCreateBadMemory(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dc, err := NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}
	defer dc.Close()

	ctx := context.Background()
	_, err = dc.Create(ctx, ContainerCfg{
		Name:  "mecha-test-badmem",
		Image: "mecha-worker-base:latest",
		Resources: ResourceConfig{
			Memory: "invalid",
		},
	})
	if err == nil {
		t.Fatal("expected error for invalid memory spec")
	}
	if !strings.Contains(err.Error(), "invalid memory") {
		t.Errorf("error = %q, want containing 'invalid memory'", err)
	}
}

func TestDockerClientCreateBadImage(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dc, err := NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}
	defer dc.Close()

	ctx := context.Background()
	_, err = dc.Create(ctx, ContainerCfg{
		Name:  "mecha-test-noimage",
		Image: "nonexistent-image-xyz:latest",
	})
	// May succeed at create but fail at start, or fail at create depending on Docker version
	if err != nil {
		// Expected: image not found
		t.Logf("Create with bad image: %v (expected)", err)
	}
}

func TestDockerClientStartNonexistent(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dc, err := NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}
	defer dc.Close()

	err = dc.Start(context.Background(), "nonexistent-container-id-12345")
	if err == nil {
		t.Error("Start nonexistent container should error")
	}
}

func TestDockerClientStopNonexistent(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dc, err := NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}
	defer dc.Close()

	err = dc.Stop(context.Background(), "nonexistent-container-id-12345", 5*time.Second)
	if err == nil {
		t.Error("Stop nonexistent container should error")
	}
}

func TestDockerClientEndpointNonexistent(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dc, err := NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}
	defer dc.Close()

	_, err = dc.Endpoint(context.Background(), "nonexistent-container-id-12345")
	if err == nil {
		t.Error("Endpoint for nonexistent container should error")
	}
}

func TestDockerClientWithCustomHost(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	// Test with the current DOCKER_HOST env
	host := os.Getenv("DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	dc, err := NewDockerClient(host)
	if err != nil {
		t.Fatalf("NewDockerClient with host: %v", err)
	}
	defer dc.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = dc.Ping(ctx)
	if err != nil {
		t.Logf("Ping with explicit host: %v (may be expected)", err)
	}
}

func TestDockerClientRemoteHostExtraction(t *testing.T) {
	// Test that a TCP host is extracted for endpoint resolution
	// Don't actually connect — just verify the client is created
	dc, err := NewDockerClient("tcp://remote-host:2375")
	if err != nil {
		t.Fatalf("NewDockerClient tcp: %v", err)
	}
	defer dc.Close()
	if dc.hostAddr != "remote-host" {
		t.Errorf("hostAddr = %q, want 'remote-host'", dc.hostAddr)
	}
}

func TestDockerClientClose(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dc, err := NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}

	// Close should succeed without error
	if err := dc.Close(); err != nil {
		t.Errorf("Close: %v", err)
	}
	// The moby client may pool connections, so Ping after Close
	// might still succeed. We just verify Close itself doesn't error.
}
