package cli

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"mecha.im/internal/ssh"
	"mecha.im/internal/worker"
)

const sshTimeout = 30 * time.Second

// sshTunnels holds running SSH tunnels keyed by worker name.
var (
	sshTunnels   = make(map[string]*ssh.Tunnel)
	sshTunnelsMu sync.Mutex
)

func newSSHClient(sc *worker.SSHConfig) *ssh.Client {
	return &ssh.Client{
		Host: sc.Host,
		User: sc.User,
		Port: sc.Port,
		Key:  sc.Key,
	}
}

func newSSHRunner(sc *worker.SSHConfig, env map[string]string) *ssh.Runner {
	return &ssh.Runner{
		Client: newSSHClient(sc),
		Mode:   sc.Mode,
		Cwd:    sc.Cwd,
		Env:    env,
	}
}

// sshStart validates SSH connectivity and sets the worker online.
// For interactive mode, starts a runtime server on the remote and tunnels it back.
func sshStart(reg *worker.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	sc := e.Worker.SSH

	env, err := worker.BuildSSHEnv(sc)
	if err != nil {
		return fmt.Errorf("build ssh env: %w", err)
	}

	client := newSSHClient(sc)
	runner := newSSHRunner(sc, env)

	ctx, cancel := context.WithTimeout(context.Background(), sshTimeout)
	defer cancel()

	fmt.Printf("connecting to %s@%s...\n", sc.User, sc.Host)
	if err := client.Ping(ctx); err != nil {
		setErrState(reg, name, err)
		return fmt.Errorf("ssh ping: %w", err)
	}

	fmt.Printf("checking claude cli on %s...\n", sc.Host)
	if err := runner.CheckCLI(ctx); err != nil {
		setErrState(reg, name, err)
		return fmt.Errorf("check cli: %w", err)
	}

	if sc.Mode == "interactive" {
		return sshStartInteractive(reg, name, sc, client, env)
	}
	// Oneshot: no persistent process, just mark online.
	return reg.SetRuntime(name, "", "")
}

// sshStartInteractive launches a runtime server on the remote, tunnels it back.
func sshStartInteractive(reg *worker.Registry, name string, sc *worker.SSHConfig, client *ssh.Client, env map[string]string) error {
	fmt.Printf("starting runtime server on %s...\n", sc.Host)

	ctx, cancel := context.WithTimeout(context.Background(), sshTimeout)
	defer cancel()

	// Start remote runtime server and capture its port.
	startCmd := "cd " + shellQuote(sc.Cwd) + " && nohup bun run /opt/mecha/runtime/server.ts > /tmp/mecha-worker.log 2>&1 & sleep 2 && grep -o 'listening on :[0-9]*' /tmp/mecha-worker.log"
	out, err := client.RunWithEnv(ctx, env, startCmd)
	if err != nil {
		setErrState(reg, name, err)
		return fmt.Errorf("start remote server: %w", err)
	}

	remotePort, err := ssh.ParseRemotePort(out)
	if err != nil {
		setErrState(reg, name, err)
		return fmt.Errorf("parse remote port: %w", err)
	}

	tunnel := &ssh.Tunnel{Client: client, RemotePort: remotePort}
	localPort, err := tunnel.Start(context.Background())
	if err != nil {
		setErrState(reg, name, err)
		return fmt.Errorf("start tunnel: %w", err)
	}

	sshTunnelsMu.Lock()
	sshTunnels[name] = tunnel
	sshTunnelsMu.Unlock()

	endpoint := fmt.Sprintf("http://127.0.0.1:%d", localPort)
	fmt.Printf("tunnel %s:%d → localhost:%d\n", sc.Host, remotePort, localPort)

	// Wait for health through the tunnel.
	if err := waitForSSHHealth(endpoint, sshTimeout); err != nil {
		tunnel.Stop()
		sshTunnelsMu.Lock()
		delete(sshTunnels, name)
		sshTunnelsMu.Unlock()
		setErrState(reg, name, err)
		return fmt.Errorf("health check: %w", err)
	}
	return reg.SetRuntime(name, "", endpoint)
}

// sshStop stops an SSH worker. For interactive mode, kills remote server and tunnel.
func sshStop(reg *worker.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}

	// Stop tunnel if interactive.
	sshTunnelsMu.Lock()
	tunnel, hasTunnel := sshTunnels[name]
	if hasTunnel {
		delete(sshTunnels, name)
	}
	sshTunnelsMu.Unlock()

	if hasTunnel {
		tunnel.Stop()
	}

	// Kill remote server if interactive.
	if e.Worker.SSH.Mode == "interactive" {
		client := newSSHClient(e.Worker.SSH)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = client.Run(ctx, "pkill -f 'mecha/runtime/server.ts' 2>/dev/null")
	}

	return reg.StopRuntime(name)
}

func waitForSSHHealth(endpoint string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting for health on %s", endpoint)
		case <-ticker.C:
			if err := worker.CheckHealth(endpoint, 3*time.Second); err == nil {
				return nil
			}
		}
	}
}

func setErrState(reg *worker.Registry, name string, err error) {
	if setErr := reg.SetError(name, err.Error()); setErr != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to set error state for %s: %v\n", name, setErr)
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
