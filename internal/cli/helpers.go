package cli

import "strings"

// Env vars that must never be injected into worker containers.
// Checked case-insensitively.
var blockedEnvKeys = map[string]bool{
	"github_token": true, "gh_token": true,
	"github_app_key": true, "github_app_id": true,
	"github_app_private_key": true, "github_app_installation_id": true,
	"github_pat": true, "github_access_token": true,
	"gh_enterprise_token": true, "github_webhook_secret": true,
}

// looksLikeCredential returns true if v resembles a GitHub credential by prefix.
func looksLikeCredential(v string) bool {
	return strings.HasPrefix(v, "ghp_") ||
		strings.HasPrefix(v, "ghs_") ||
		strings.HasPrefix(v, "ghr_") ||
		strings.HasPrefix(v, "gho_") ||
		strings.HasPrefix(v, "ghu_") ||
		strings.HasPrefix(v, "ghes_") ||
		strings.HasPrefix(v, "github_pat_")
}
