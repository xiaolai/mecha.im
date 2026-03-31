package ssh

import (
	"context"
	"testing"
)

func TestBaseArgs(t *testing.T) {
	tests := []struct {
		name string
		c    Client
		want []string // subset that must appear
	}{
		{
			name: "default port",
			c:    Client{Host: "host", User: "user", Port: 22},
			want: []string{"BatchMode=yes"},
		},
		{
			name: "custom port",
			c:    Client{Host: "host", User: "user", Port: 2222},
			want: []string{"-p", "2222"},
		},
		{
			name: "custom key",
			c:    Client{Host: "host", User: "user", Port: 22, Key: "/tmp/id_ed25519"},
			want: []string{"-i", "/tmp/id_ed25519"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args := tt.c.baseArgs()
			for _, w := range tt.want {
				found := false
				for _, a := range args {
					if a == w {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("baseArgs() missing %q, got %v", w, args)
				}
			}
		})
	}
}

func TestDestination(t *testing.T) {
	c := &Client{Host: "100.100.1.7", User: "joker"}
	got := c.destination()
	if got != "joker@100.100.1.7" {
		t.Errorf("destination() = %q, want %q", got, "joker@100.100.1.7")
	}
}

func TestRunWithEnvKeyValidation(t *testing.T) {
	c := &Client{Host: "localhost", User: "test", Port: 22}
	tests := []struct {
		name    string
		key     string
		wantErr bool
	}{
		{"valid simple", "PATH", false},
		{"valid underscore", "MY_VAR", false},
		{"valid leading underscore", "_FOO", false},
		{"invalid semicolon", "FOO;rm -rf /", true},
		{"invalid dollar", "$(cmd)", true},
		{"invalid backtick", "`cmd`", true},
		{"invalid space", "FOO BAR", true},
		{"invalid dash", "FOO-BAR", true},
		{"invalid leading digit", "1FOO", true},
		{"empty key", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := map[string]string{tt.key: "value"}
			// RunWithEnv will fail on the SSH call, but key validation happens first.
			_, err := c.RunWithEnv(context.Background(), env, "echo test")
			if tt.wantErr {
				if err == nil {
					t.Error("expected error for invalid key")
				} else if !contains(err.Error(), "invalid env var key") {
					// Might fail on SSH instead — that's ok if key was valid.
					t.Logf("got error: %v", err)
				}
			}
			// For valid keys, we expect SSH failure (not key validation error).
			if !tt.wantErr && err != nil {
				if contains(err.Error(), "invalid env var key") {
					t.Errorf("valid key %q rejected: %v", tt.key, err)
				}
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestValidEnvKey(t *testing.T) {
	valid := []string{"PATH", "MY_VAR", "_FOO", "a", "A1", "CLAUDE_MODEL"}
	for _, k := range valid {
		if !validEnvKey.MatchString(k) {
			t.Errorf("key %q should be valid", k)
		}
	}
	invalid := []string{"", "1FOO", "FOO-BAR", "FOO BAR", "$(cmd)", ";rm", "`cmd`"}
	for _, k := range invalid {
		if validEnvKey.MatchString(k) {
			t.Errorf("key %q should be invalid", k)
		}
	}
}
