package worker

import "regexp"

var secretPatterns = regexp.MustCompile(
	`(?i)(` +
		`sk-ant-[a-zA-Z0-9_-]+|` + // Anthropic (OAuth + API)
		`sk-[a-zA-Z0-9_-]{20,}|` + // OpenAI API keys
		`ghp_[a-zA-Z0-9]+|` + // GitHub PAT
		`ghs_[a-zA-Z0-9]+|` + // GitHub server token
		`ghr_[a-zA-Z0-9]+|` + // GitHub refresh token
		`github_pat_[a-zA-Z0-9_]+|` + // GitHub fine-grained PAT
		`AIza[a-zA-Z0-9_-]{30,}|` + // Google API key
		`ya29\.[a-zA-Z0-9_.-]+|` + // Google OAuth access token
		`eyJ[a-zA-Z0-9_-]{20,}|` + // JWTs (first segment)
		`Bearer\s+[a-zA-Z0-9._-]+` + // Bearer tokens
		`)`,
)

func RedactSecrets(s string) string {
	return secretPatterns.ReplaceAllString(s, "[REDACTED]")
}
