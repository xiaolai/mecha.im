package ssh

import "testing"

func TestBuildCLICommand(t *testing.T) {
	tests := []struct {
		name   string
		runner Runner
		prompt string
		want   string
	}{
		{
			name:   "simple prompt no cwd",
			runner: Runner{Cwd: ""},
			prompt: "hello world",
			want:   "claude -p 'hello world' --output-format json --bare --dangerously-skip-permissions",
		},
		{
			name:   "prompt with cwd",
			runner: Runner{Cwd: "/home/user/project"},
			prompt: "review this",
			want:   "cd '/home/user/project' && claude -p 'review this' --output-format json --bare --dangerously-skip-permissions",
		},
		{
			name:   "prompt with single quotes",
			runner: Runner{Cwd: ""},
			prompt: "what's this",
			want:   "claude -p 'what'\\''s this' --output-format json --bare --dangerously-skip-permissions",
		},
		{
			name:   "cwd with spaces",
			runner: Runner{Cwd: "/home/user/my project"},
			prompt: "check it",
			want:   "cd '/home/user/my project' && claude -p 'check it' --output-format json --bare --dangerously-skip-permissions",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.runner.buildCLICommand(tt.prompt)
			if got != tt.want {
				t.Errorf("buildCLICommand() =\n  %q\nwant:\n  %q", got, tt.want)
			}
		})
	}
}
