package workers

import "mecha.im/internal/redact"

// RedactSecrets replaces known credential patterns with [REDACTED].
// Delegates to internal/redact — the canonical implementation.
func RedactSecrets(s string) string {
	return redact.Secrets(s)
}
