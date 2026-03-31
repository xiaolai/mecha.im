package serve

import "testing"

func TestValidateDisposableEnv(t *testing.T) {
	tests := []struct {
		key     string
		wantErr bool
	}{
		{"CLAUDE_MODEL", false},
		{"MY_VAR", false},
		{"WORKER_BACKEND", true},
		{"worker_port", true},
		{"WORKER_API_KEY", true},
		{"HOME", true},
		{"home", true},
		{"HOMEPATH", false}, // only exact "home" is blocked
	}
	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			err := validateDisposableEnv(tt.key, "val")
			if (err != nil) != tt.wantErr {
				t.Errorf("validateDisposableEnv(%q) error = %v, wantErr %v", tt.key, err, tt.wantErr)
			}
		})
	}
}

func TestRandomSuffix(t *testing.T) {
	s1 := randomSuffix()
	s2 := randomSuffix()
	if len(s1) != 16 { // 8 bytes → 16 hex chars
		t.Errorf("randomSuffix() len = %d, want 16", len(s1))
	}
	if s1 == s2 {
		t.Error("two calls should produce different values")
	}
}
