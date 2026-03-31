package ssh

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

// Tunnel manages an SSH local port forward from localhost to a remote port.
type Tunnel struct {
	Client     *Client
	RemotePort int

	mu        sync.Mutex
	cmd       *exec.Cmd
	localPort int
	cancel    context.CancelFunc
}

// Start opens an SSH tunnel: localhost:random → remote:RemotePort.
// Returns the local port. Call Stop to tear down.
func (t *Tunnel) Start(ctx context.Context) (int, error) {
	localPort, err := freePort()
	if err != nil {
		return 0, fmt.Errorf("find free port: %w", err)
	}

	tunnelCtx, cancel := context.WithCancel(ctx)
	forward := fmt.Sprintf("%d:127.0.0.1:%d", localPort, t.RemotePort)

	args := t.Client.baseArgs()
	args = append(args, "-N", "-L", forward, t.Client.destination())
	cmd := exec.CommandContext(tunnelCtx, "ssh", args...)

	// Capture stderr for diagnostics.
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return 0, fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return 0, fmt.Errorf("start tunnel: %w", err)
	}

	// Read first line of stderr in background for early failure detection.
	errCh := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stderr)
		if scanner.Scan() {
			errCh <- scanner.Text()
		}
		close(errCh)
	}()

	t.mu.Lock()
	t.cmd = cmd
	t.localPort = localPort
	t.cancel = cancel
	t.mu.Unlock()

	return localPort, nil
}

// LocalPort returns the local end of the tunnel.
func (t *Tunnel) LocalPort() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.localPort
}

// Endpoint returns the HTTP URL for the local tunnel endpoint.
func (t *Tunnel) Endpoint() string {
	return "http://127.0.0.1:" + strconv.Itoa(t.LocalPort())
}

// Stop tears down the SSH tunnel.
func (t *Tunnel) Stop() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cancel != nil {
		t.cancel()
		t.cancel = nil
	}
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
		_ = t.cmd.Wait()
		t.cmd = nil
	}
	return nil
}

// freePort finds an available TCP port on localhost.
func freePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	return port, nil
}

// ParseRemotePort extracts a port number from runtime server startup output.
// Expects output containing "listening on :PORT" or just "PORT".
func ParseRemotePort(output string) (int, error) {
	line := strings.TrimSpace(output)
	// Try "listening on :8081" pattern.
	if idx := strings.LastIndex(line, ":"); idx >= 0 {
		portStr := line[idx+1:]
		if p, err := strconv.Atoi(strings.TrimSpace(portStr)); err == nil && p > 0 {
			return p, nil
		}
	}
	// Try plain number.
	if p, err := strconv.Atoi(line); err == nil && p > 0 {
		return p, nil
	}
	return 0, fmt.Errorf("cannot parse remote port from %q", line)
}
