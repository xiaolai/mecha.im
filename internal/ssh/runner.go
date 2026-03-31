package ssh

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Runner manages SSH worker lifecycle for both oneshot and interactive modes.
type Runner struct {
	Client *Client
	Mode   string // "oneshot" or "interactive"
	Cwd    string // remote working directory
	Env    map[string]string
}

// CheckCLI verifies that claude CLI is installed on the remote host.
func (r *Runner) CheckCLI(ctx context.Context) error {
	out, err := r.Client.Run(ctx, "which claude 2>/dev/null || echo NOTFOUND")
	if err != nil {
		return fmt.Errorf("check claude cli: %w", err)
	}
	if strings.TrimSpace(out) == "NOTFOUND" {
		return fmt.Errorf("claude cli not found on %s", r.Client.Host)
	}
	return nil
}

// ExecTask runs a prompt via claude -p on the remote host (oneshot mode).
// Returns the raw JSON output from claude.
func (r *Runner) ExecTask(ctx context.Context, prompt string) (json.RawMessage, error) {
	cmd := r.buildCLICommand(prompt)
	out, err := r.Client.RunWithEnv(ctx, r.Env, cmd)
	if err != nil {
		return nil, fmt.Errorf("exec task: %w", err)
	}
	raw := strings.TrimSpace(out)
	if !json.Valid([]byte(raw)) {
		return nil, fmt.Errorf("exec task: invalid JSON output: %.200s", raw)
	}
	return json.RawMessage(raw), nil
}

// buildCLICommand constructs the claude -p command string.
func (r *Runner) buildCLICommand(prompt string) string {
	escaped := strings.ReplaceAll(prompt, "'", "'\\''")
	var b strings.Builder
	if r.Cwd != "" {
		fmt.Fprintf(&b, "cd '%s' && ", strings.ReplaceAll(r.Cwd, "'", "'\\''"))
	}
	b.WriteString("claude -p '")
	b.WriteString(escaped)
	b.WriteString("' --output-format json --bare --dangerously-skip-permissions")
	return b.String()
}
