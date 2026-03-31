package cli

import (
	"testing"

	"mecha.im/internal/worker"
)

func TestCheckWorkerCwd(t *testing.T) {
	tests := []struct {
		name string
		cwd  string
		want bool
	}{
		{"empty cwd", "", true},
		{"valid dir", t.TempDir(), true},
		{"nonexistent", "/nonexistent/dir/xyz", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := &worker.Worker{
				Name:   "test",
				Docker: &worker.DockerConfig{Image: "test", Cwd: tt.cwd},
			}
			if got := checkWorkerCwd(w); got != tt.want {
				t.Errorf("checkWorkerCwd(%q) = %v, want %v", tt.cwd, got, tt.want)
			}
		})
	}
}

func TestCheckWorkerToken(t *testing.T) {
	secrets := &worker.Secrets{
		Tokens: map[string]map[string]string{
			"claude": {"work": "sk-ant-oat01-abc"},
		},
	}
	tests := []struct {
		name    string
		token   string
		secrets *worker.Secrets
		want    bool
	}{
		{"no token", "", secrets, true},
		{"resolves", "claude.work", secrets, true},
		{"missing", "claude.nope", secrets, false},
		{"nil secrets", "claude.work", nil, true}, // warn, not fail
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := &worker.Worker{
				Name:   "test",
				Docker: &worker.DockerConfig{Image: "test", Token: tt.token},
			}
			if got := checkWorkerToken(w, tt.secrets); got != tt.want {
				t.Errorf("checkWorkerToken(%q) = %v, want %v", tt.token, got, tt.want)
			}
		})
	}
}

func TestCheckWorkerEntryNoDocker(t *testing.T) {
	e := worker.Entry{
		Worker: &worker.Worker{
			Name:     "live",
			Endpoint: "http://localhost:9999",
		},
	}
	// Should return true (no docker/adapter checks)
	if !checkWorkerEntry(e, nil, nil) {
		t.Error("live worker entry should pass")
	}
}

func TestLoadSecretsQuiet(t *testing.T) {
	// Should not panic regardless of environment
	_ = loadSecretsQuiet()
}
