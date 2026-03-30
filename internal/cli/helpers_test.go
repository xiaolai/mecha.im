package cli

import (
	"testing"
)

func TestReservedEnvKeys(t *testing.T) {
	reserved := []string{
		"WORKER_BACKEND", "worker_port", "WORKER_API_KEY",
		"Worker_Timeout", "WORKER_DRY_RUN", "HOME",
	}
	for _, k := range reserved {
		if !isReservedEnvKey(k) {
			t.Errorf("%q should be reserved", k)
		}
	}
	allowed := []string{
		"CLAUDE_MODEL", "GITHUB_TOKEN", "MY_VAR", "OPENAI_API_KEY",
	}
	for _, k := range allowed {
		if isReservedEnvKey(k) {
			t.Errorf("%q should not be reserved", k)
		}
	}
}
