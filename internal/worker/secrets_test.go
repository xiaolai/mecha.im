package worker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadSecrets(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.yml")
	yaml := `tokens:
  claude:
    work: sk-ant-oat01-abc123
    api: sk-ant-api03-def456
  codex:
    default: sk-proj-ghi789
  gemini:
    default: AIzaSyTest123
github:
  token: ghp_test123
`
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := LoadSecrets(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if s.GitHub.Token != "ghp_test123" {
		t.Errorf("github.token = %q", s.GitHub.Token)
	}
}

func TestSecretsResolve(t *testing.T) {
	s := &Secrets{
		Tokens: map[string]map[string]string{
			"claude": {"work": "sk-ant-oat01-abc", "api": "sk-ant-api03-def"},
			"codex":  {"default": "sk-proj-xyz"},
		},
	}
	tests := []struct {
		ref     string
		want    string
		wantErr bool
	}{
		{"claude.work", "sk-ant-oat01-abc", false},
		{"claude.api", "sk-ant-api03-def", false},
		{"codex.default", "sk-proj-xyz", false},
		{"claude.missing", "", true},
		{"unknown.key", "", true},
		{"badref", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			got, err := s.Resolve(tt.ref)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDetectTokenEnvVar(t *testing.T) {
	tests := []struct {
		token   string
		wantKey string
	}{
		{"sk-ant-oat01-abc", "CLAUDE_CODE_OAUTH_TOKEN"},
		{"sk-ant-api03-def", "ANTHROPIC_API_KEY"},
		{"sk-proj-abc123xyz", "OPENAI_API_KEY"},
		{"AIzaSyBmmkGm-test", "GEMINI_API_KEY"},
		{"unknown-token", ""},
	}
	for _, tt := range tests {
		t.Run(tt.token[:10], func(t *testing.T) {
			key, _ := DetectTokenEnvVar(tt.token)
			if key != tt.wantKey {
				t.Errorf("key = %q, want %q", key, tt.wantKey)
			}
		})
	}
}

func TestLoadSecretsMissingFile(t *testing.T) {
	s, err := LoadSecrets("/nonexistent/secrets.yml")
	if err != nil {
		t.Fatalf("missing file should not error: %v", err)
	}
	if s == nil {
		t.Fatal("should return empty secrets")
	}
}
