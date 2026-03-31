package cli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"mecha.im/internal/ssh"
	"mecha.im/internal/worker"
)

const sshTimeout = 30 * time.Second

var sshLog = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

func newSSHClient(sc *worker.SSHConfig) *ssh.Client {
	return &ssh.Client{
		Host:       sc.Host,
		User:       sc.User,
		Port:       sc.Port,
		Key:        sc.Key,
		RedactFunc: worker.RedactSecrets,
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

	sshLog.Info("connecting", "host", sc.Host, "user", sc.User)
	fmt.Printf("connecting to %s@%s...\n", sc.User, sc.Host)
	if err := client.Ping(ctx); err != nil {
		setErrState(reg, name, err)
		return fmt.Errorf("ssh ping: %w", err)
	}

	sshLog.Info("checking claude cli", "host", sc.Host)
	fmt.Printf("checking claude cli on %s...\n", sc.Host)
	if err := runner.CheckCLI(ctx); err != nil {
		setErrState(reg, name, err)
		return fmt.Errorf("check cli: %w", err)
	}

	if sc.Mode == "interactive" {
		return sshStartInteractive(reg, name, sc, client, env)
	}
	return reg.SetRuntime(name, "", "")
}
