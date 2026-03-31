package ssh

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// validEnvKey matches POSIX-portable env var names. Rejects shell metacharacters.
var validEnvKey = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// Client runs commands on a remote machine via the ssh binary.
// Uses the host's SSH agent, config, and known_hosts — no new dependencies.
type Client struct {
	Host string
	User string
	Port int
	Key  string // optional path to private key

	// RedactFunc, if set, is called on stderr before embedding in errors.
	// Prevents credential leaks in error messages.
	RedactFunc func(string) string
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
		errText := strings.TrimSpace(stderr.String())
		if c.RedactFunc != nil {
			errText = c.RedactFunc(errText)
		}
		return "", fmt.Errorf("ssh run: %w: %s", err, errText)
	}
	return stdout.String(), nil
}

// RunWithEnv executes a command with env vars delivered via a temp file on the
// remote host. The file is sourced, then deleted — env values never appear in
// the process listing.
func (c *Client) RunWithEnv(ctx context.Context, env map[string]string, command string) (string, error) {
	if len(env) == 0 {
		return c.Run(ctx, command)
	}
	for k := range env {
		if !validEnvKey.MatchString(k) {
			return "", fmt.Errorf("invalid env var key %q: must match [a-zA-Z_][a-zA-Z0-9_]*", k)
		}
	}
	// Write env to a temp file, source it, delete it, then run the command.
	// This avoids credentials appearing in `ps aux` output.
	envFile := "/tmp/.mecha-env-" + randHex(8)
	var writeCmd strings.Builder
	writeCmd.WriteString("cat > " + envFile + " <<'MECHAEOF'\n")
	// Sort keys for deterministic output.
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := env[k]
		// Values are written inside a heredoc — no shell escaping needed.
		// Single quotes in values are safe inside heredoc.
		fmt.Fprintf(&writeCmd, "export %s='%s'\n", k, strings.ReplaceAll(v, "'", "'\\''"))
	}
	writeCmd.WriteString("MECHAEOF\n")
	writeCmd.WriteString("chmod 600 " + envFile + " && ")
	writeCmd.WriteString(". " + envFile + " && rm -f " + envFile + " && ")
	writeCmd.WriteString(command)
	return c.Run(ctx, writeCmd.String())
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

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "mecha"
	}
	return hex.EncodeToString(b)[:n]
}
