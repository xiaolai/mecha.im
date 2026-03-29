package worker

import "regexp"

var secretPatterns = regexp.MustCompile(
	`(?i)(sk-ant-[a-zA-Z0-9_-]+|ghp_[a-zA-Z0-9]+|ghs_[a-zA-Z0-9]+|` +
		`ghr_[a-zA-Z0-9]+|github_pat_[a-zA-Z0-9_]+|Bearer\s+[a-zA-Z0-9._-]+)`,
)

func RedactSecrets(s string) string {
	return secretPatterns.ReplaceAllString(s, "[REDACTED]")
}
