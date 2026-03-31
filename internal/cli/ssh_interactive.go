package cli

import (
	"context"
	"fmt"
	"strings"
	"syscall"
	"time"

	"mecha.im/internal/ssh"
	"mecha.im/internal/worker"
)

// sshStartInteractive launches a runtime server on the remote, tunnels it back.
// Persists tunnel PID in registry so stop works from a fresh CLI process.
func sshStartInteractive(reg *worker.Registry, name string, sc *worker.SSHConfig, client *ssh.Client, env map[string]string) error {
	sshLog.Info("starting interactive runtime", "host", sc.Host, "worker", name)
	fmt.Printf("starting runtime server on %s...\n", sc.Host)

	ctx, cancel := context.WithTimeout(context.Background(), sshTimeout)
	defer cancel()

	// Check bun is available on remote.
	if _, err := client.Run(ctx, "which bun 2>/dev/null || echo NOTFOUND"); err != nil {
		setErrState(reg, name, err)
		return fmt.Errorf("check bun: %w", err)
	}

	// Start remote runtime with PID file and per-worker log.
	pidFile := fmt.Sprintf("/tmp/mecha-worker-%s.pid", name)
	logFile := fmt.Sprintf("/tmp/mecha-worker-%s.log", name)
	cwdCmd := ""
	if sc.Cwd != "" {
		cwdCmd = "cd " + shellQuote(sc.Cwd) + " && "
	}
	startCmd := fmt.Sprintf(
		"%snohup bun run /opt/mecha/runtime/server.ts > %s 2>&1 & echo $! > %s && sleep 1 && "+
			"if ! kill -0 $(cat %s) 2>/dev/null; then echo FAILED; cat %s; exit 1; fi && "+
			"grep -o 'listening on :[0-9]*' %s || tail -5 %s",
		cwdCmd, logFile, pidFile, pidFile, logFile, logFile, logFile,
	)
	out, err := client.RunWithEnv(ctx, env, startCmd)
	if err != nil {
		setErrState(reg, name, err)
		return fmt.Errorf("start remote server: %w", err)
	}
	if strings.Contains(out, "FAILED") {
		setErrState(reg, name, fmt.Errorf("remote server crashed: %s", out))
		return fmt.Errorf("remote server failed to start:\n%s", out)
	}

	remotePort, err := ssh.ParseRemotePort(out)
	if err != nil {
		// Try to get the log for diagnostics.
		logOut, _ := client.Run(ctx, "tail -10 "+logFile)
		setErrState(reg, name, err)
		return fmt.Errorf("parse remote port: %w\nremote log:\n%s", err, logOut)
	}

	// Open SSH tunnel with the caller's context for cancellation safety.
	tunnel := &ssh.Tunnel{Client: client, RemotePort: remotePort}
	localPort, err := tunnel.Start(ctx)
	if err != nil {
		// Cleanup: kill the remote server we just started.
		killRemoteByPIDFile(client, pidFile)
		setErrState(reg, name, err)
		return fmt.Errorf("start tunnel: %w", err)
	}

	// Persist tunnel PID so stop works from a fresh CLI process.
	tunnelPID := tunnel.PID()
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", localPort)
	sshLog.Info("tunnel established", "host", sc.Host, "remote_port", remotePort, "local_port", localPort, "pid", tunnelPID)
	fmt.Printf("tunnel %s:%d -> localhost:%d (pid %d)\n", sc.Host, remotePort, localPort, tunnelPID)

	// Health check through the tunnel.
	if err := waitForSSHHealth(endpoint, sshTimeout); err != nil {
		tunnel.Stop()
		killRemoteByPIDFile(client, pidFile)
		setErrState(reg, name, err)
		return fmt.Errorf("health check: %w", err)
	}

	if err := reg.SetRuntime(name, "", endpoint); err != nil {
		tunnel.Stop()
		killRemoteByPIDFile(client, pidFile)
		return err
	}
	return reg.SetSSHTunnel(name, tunnelPID, localPort)
}

// sshStop stops an SSH worker. Kills tunnel by persisted PID, kills remote by PID file.
func sshStop(reg *worker.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	sc := e.Worker.SSH

	// Kill local tunnel process by persisted PID.
	if e.TunnelPID > 0 {
		sshLog.Info("killing tunnel", "pid", e.TunnelPID, "worker", name)
		if err := syscall.Kill(e.TunnelPID, syscall.SIGTERM); err != nil {
			sshLog.Warn("tunnel kill failed", "pid", e.TunnelPID, "err", err)
		}
	}

	// Kill remote server by PID file (interactive mode only).
	if sc != nil && sc.Mode == "interactive" {
		client := newSSHClient(sc)
		pidFile := fmt.Sprintf("/tmp/mecha-worker-%s.pid", name)
		killRemoteByPIDFile(client, pidFile)
	}

	return reg.StopRuntime(name)
}

// killRemoteByPIDFile reads a PID file on the remote and kills that specific process.
func killRemoteByPIDFile(client *ssh.Client, pidFile string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := fmt.Sprintf(
		"if [ -f %s ]; then kill $(cat %s) 2>/dev/null; rm -f %s; fi",
		pidFile, pidFile, pidFile,
	)
	if _, err := client.Run(ctx, cmd); err != nil {
		sshLog.Warn("remote cleanup failed", "pidFile", pidFile, "err", worker.RedactSecrets(err.Error()))
	}
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
		sshLog.Error("failed to set error state", "worker", name, "err", worker.RedactSecrets(setErr.Error()))
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
