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
			runner: Runner{Env: map[string]string{}},
			prompt: "hello world",
			want:   "claude -p 'hello world' --output-format json --bare --permission-mode bypassPermissions",
		},
		{
			name:   "prompt with cwd",
			runner: Runner{Cwd: "/home/user/project", Env: map[string]string{}},
			prompt: "review this",
			want:   "cd '/home/user/project' && claude -p 'review this' --output-format json --bare --permission-mode bypassPermissions",
		},
		{
			name:   "prompt with single quotes",
			runner: Runner{Env: map[string]string{}},
			prompt: "what's this",
			want:   "claude -p 'what'\\''s this' --output-format json --bare --permission-mode bypassPermissions",
		},
		{
			name:   "custom permission mode",
			runner: Runner{Env: map[string]string{"CLAUDE_PERMISSION_MODE": "default"}},
			prompt: "check it",
			want:   "claude -p 'check it' --output-format json --bare --permission-mode default",
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

func TestExtractJSON(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"clean json", `[{"type":"result"}]`, `[{"type":"result"}]`},
		{"motd prefix", "Welcome to server\n[{\"type\":\"result\"}]", `[{"type":"result"}]`},
		{"motd prefix and suffix", "Banner\n{\"ok\":true}\nBye", `{"ok":true}`},
		{"no json", "just text", "just text"},
		{"empty", "", ""},
		{"object", `{"key":"val"}`, `{"key":"val"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractJSON(tt.input)
			if got != tt.want {
				t.Errorf("extractJSON() = %q, want %q", got, tt.want)
			}
		})
	}
}
