package ssh

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// Client runs commands on a remote machine via the ssh binary.
// Uses the host's SSH agent, config, and known_hosts — no new dependencies.
type Client struct {
	Host string
	User string
	Port int
	Key  string // optional path to private key
}

// baseArgs builds the common ssh flags (user, port, key, strict options).
func (c *Client) baseArgs() []string {
	args := []string{
		"-o", "BatchMode=yes",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "ConnectTimeout=10",
	}
	if c.Port != 0 && c.Port != 22 {
		args = append(args, "-p", strconv.Itoa(c.Port))
	}
	if c.Key != "" {
		args = append(args, "-i", c.Key)
	}
	return args
}

// destination returns user@host.
func (c *Client) destination() string {
	return c.User + "@" + c.Host
}

// Run executes a command on the remote host and returns stdout.
func (c *Client) Run(ctx context.Context, command string) (string, error) {
	args := c.baseArgs()
	args = append(args, c.destination(), command)
	cmd := exec.CommandContext(ctx, "ssh", args...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("ssh run: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

// RunWithEnv executes a command on the remote host with env vars prepended.
func (c *Client) RunWithEnv(ctx context.Context, env map[string]string, command string) (string, error) {
	if len(env) == 0 {
		return c.Run(ctx, command)
	}
	var prefix strings.Builder
	for k, v := range env {
		// Shell-safe: single-quote values, escape embedded single quotes.
		escaped := strings.ReplaceAll(v, "'", "'\\''")
		fmt.Fprintf(&prefix, "%s='%s' ", k, escaped)
	}
	return c.Run(ctx, prefix.String()+command)
}

// Ping verifies SSH connectivity by running a trivial command.
func (c *Client) Ping(ctx context.Context) error {
	out, err := c.Run(ctx, "echo ok")
	if err != nil {
		return fmt.Errorf("ssh ping %s: %w", c.Host, err)
	}
	if strings.TrimSpace(out) != "ok" {
		return fmt.Errorf("ssh ping %s: unexpected output %q", c.Host, out)
	}
	return nil
}
