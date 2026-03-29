package cli

import (
	"strings"
	"testing"
)

func TestLooksLikeCredential(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"ghp_abc123", true},
		{"ghs_abc123", true},
		{"ghr_abc123", true},
		{"gho_abc123", true},
		{"github_pat_abc123", true},
		{"hello-world", false},
		{"sk-ant-oat01-abc", false},
		{"CLAUDE_MODEL", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := looksLikeCredential(tt.input)
			if got != tt.want {
				t.Errorf("looksLikeCredential(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestBlockedEnvKeys(t *testing.T) {
	blocked := []string{
		"github_token", "gh_token", "github_app_key", "github_app_id",
		"github_app_private_key", "github_app_installation_id",
		"github_pat", "github_access_token",
		"gh_enterprise_token", "github_webhook_secret",
	}
	for _, k := range blocked {
		if !blockedEnvKeys[k] {
			t.Errorf("blockedEnvKeys[%q] = false, want true", k)
		}
	}
	allowed := []string{"MY_VAR", "claude_model", "openai_api_key", "home"}
	for _, k := range allowed {
		if blockedEnvKeys[strings.ToLower(k)] {
			t.Errorf("blockedEnvKeys[%q] should not be blocked", k)
		}
	}
}
