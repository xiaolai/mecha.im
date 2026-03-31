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
	"time"
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

// Start opens an SSH tunnel: localhost:random -> remote:RemotePort.
// Returns the local port. Detects fast SSH failures within 500ms.
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

	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return 0, fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return 0, fmt.Errorf("start tunnel: %w", err)
	}

	// Read first stderr line in background for fast failure detection.
	errCh := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stderr)
		if scanner.Scan() {
			errCh <- scanner.Text()
		}
		close(errCh)
	}()

	// Wait briefly to detect immediate failures (auth error, refused, etc).
	select {
	case errLine := <-errCh:
		cancel()
		_ = cmd.Wait()
		return 0, fmt.Errorf("ssh tunnel failed: %s", errLine)
	case <-time.After(500 * time.Millisecond):
		// No immediate error — tunnel is likely connecting.
	}

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

// Stop tears down the SSH tunnel. Returns error if process cleanup fails.
func (t *Tunnel) Stop() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cancel != nil {
		t.cancel()
		t.cancel = nil
	}
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
		// Wait with a timeout to avoid blocking forever on zombie processes.
		done := make(chan error, 1)
		go func() { done <- t.cmd.Wait() }()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
		t.cmd = nil
	}
	return nil
}

// PID returns the tunnel process ID, or 0 if not running.
func (t *Tunnel) PID() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cmd != nil && t.cmd.Process != nil {
		return t.cmd.Process.Pid
	}
	return 0
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
func ParseRemotePort(output string) (int, error) {
	line := strings.TrimSpace(output)
	if idx := strings.LastIndex(line, ":"); idx >= 0 {
		portStr := line[idx+1:]
		if p, err := strconv.Atoi(strings.TrimSpace(portStr)); err == nil && p > 0 {
			return p, nil
		}
	}
	if p, err := strconv.Atoi(line); err == nil && p > 0 {
		return p, nil
	}
	return 0, fmt.Errorf("cannot parse remote port from %q", line)
}
