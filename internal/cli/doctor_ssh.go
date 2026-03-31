package cli

import (
	"context"
	"fmt"
	"time"

	"mecha.im/internal/ssh"
	"mecha.im/internal/worker"
)

// checkSSHToken verifies the SSH worker's token can be resolved from secrets.
func checkSSHToken(w *worker.Worker, secrets *worker.Secrets) bool {
	if w.SSH.Token == "" {
		return true
	}
	if secrets == nil {
		printStatus("warn", fmt.Sprintf("    token %s — no secrets file", w.SSH.Token))
		return true
	}
	_, err := secrets.Resolve(w.SSH.Token)
	if err != nil {
		printStatus("fail", "    token "+w.SSH.Token+": "+err.Error())
		return false
	}
	printStatus("ok", "    token "+w.SSH.Token+" resolves")
	return true
}

// checkSSHConnectivity pings the remote host and checks for claude CLI.
func checkSSHConnectivity(ctx context.Context, w *worker.Worker) bool {
	client := &ssh.Client{
		Host:       w.SSH.Host,
		User:       w.SSH.User,
		Port:       w.SSH.Port,
		Key:        w.SSH.Key,
		RedactFunc: worker.RedactSecrets,
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := client.Ping(pingCtx); err != nil {
		printStatus("warn", fmt.Sprintf("    ssh %s@%s unreachable: %v", w.SSH.User, w.SSH.Host, worker.RedactSecrets(err.Error())))
		return true // warn, not fail — host might be temporarily down
	}
	printStatus("ok", fmt.Sprintf("    ssh %s@%s reachable", w.SSH.User, w.SSH.Host))

	runner := &ssh.Runner{Client: client, Mode: w.SSH.Mode}
	cliCtx, cliCancel := context.WithTimeout(ctx, 10*time.Second)
	defer cliCancel()
	if err := runner.CheckCLI(cliCtx); err != nil {
		printStatus("fail", "    claude cli not found on "+w.SSH.Host)
		return false
	}
	printStatus("ok", "    claude cli available on "+w.SSH.Host)

	// Check bun for interactive mode.
	if w.SSH.Mode == "interactive" {
		bunCtx, bunCancel := context.WithTimeout(ctx, 10*time.Second)
		defer bunCancel()
		out, err := client.Run(bunCtx, "which bun 2>/dev/null || echo NOTFOUND")
		if err != nil || fmt.Sprintf("%s", out) == "NOTFOUND\n" {
			printStatus("warn", "    bun not found on "+w.SSH.Host+" (needed for interactive mode)")
		} else {
			printStatus("ok", "    bun available on "+w.SSH.Host)
		}
	}
	return true
}
