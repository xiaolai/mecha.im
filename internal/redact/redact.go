// Package redact provides secret-redaction utilities.
// It is a leaf package with no internal dependencies.
package redact

import "regexp"

var secretPatterns = regexp.MustCompile(
	`(?i)(` +
		`sk-ant-[a-zA-Z0-9_-]+|` + // Anthropic (OAuth + API)
		`sk-[a-zA-Z0-9_-]{20,}|` + // OpenAI API keys
		`ghp_[a-zA-Z0-9]+|` + // GitHub PAT
		`ghs_[a-zA-Z0-9]+|` + // GitHub server token
		`ghr_[a-zA-Z0-9]+|` + // GitHub refresh token
		`gho_[a-zA-Z0-9]+|` + // GitHub OAuth token
		`ghu_[a-zA-Z0-9]+|` + // GitHub user-to-server token
		`ghes_[a-zA-Z0-9]+|` + // GitHub Enterprise Server token
		`github_pat_[a-zA-Z0-9_]+|` + // GitHub fine-grained PAT
		`AIza[a-zA-Z0-9_-]{30,}|` + // Google API key
		`ya29\.[a-zA-Z0-9_.-]+|` + // Google OAuth access token
		`glpat-[a-zA-Z0-9_-]+|` + // GitLab PAT
		`https://hooks\.slack\.com/services/[a-zA-Z0-9/]+|` + // Slack webhook URLs
		`Bearer\s+[a-zA-Z0-9._-]{20,}` + // Bearer tokens (20+ chars to avoid matching prose)
		`)`,
)

// Secrets replaces known credential patterns with [REDACTED].
func Secrets(s string) string {
	return secretPatterns.ReplaceAllString(s, "[REDACTED]")
}
