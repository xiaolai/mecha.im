package worker

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mecha.im/internal/store"
)

// --- persist: error with closed DB ---

func TestPersistClosedDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg, err := NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}

	// Add a worker first (while DB is open)
	w := &Worker{Name: "test-w", Endpoint: "http://localhost:8080"}
	if err := reg.Add(w); err != nil {
		t.Fatal(err)
	}

	// Close DB then try to persist
	db.Close()

	err = reg.Add(&Worker{Name: "test-w2", Endpoint: "http://localhost:8081"})
	if err == nil {
		t.Error("expected error from closed DB in persist")
	}
}

// --- load: error with closed DB ---

func TestNewRegistryClosedDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	_, err = NewRegistry(db)
	if err == nil {
		t.Error("expected error from closed DB in NewRegistry/load")
	}
}

// --- copySliceAny: nested maps and slices ---

func TestCopySliceAnyNestedMapAndSlice(t *testing.T) {
	s := []any{
		map[string]any{"key": "val", "nested": map[string]any{"a": "b"}},
		[]any{"x", "y", []any{"z"}},
		"plain",
		42,
	}
	c := copySliceAny(s)

	// Mutate original nested map
	s[0].(map[string]any)["key"] = "mutated"
	s[0].(map[string]any)["nested"].(map[string]any)["a"] = "mutated"
	s[1].([]any)[0] = "mutated"

	// Copy should be unaffected
	if c[0].(map[string]any)["key"] != "val" {
		t.Error("nested map was mutated")
	}
	if c[0].(map[string]any)["nested"].(map[string]any)["a"] != "b" {
		t.Error("deeply nested map was mutated")
	}
	if c[1].([]any)[0] != "x" {
		t.Error("nested slice was mutated")
	}
}

func TestCopySliceAnyNil(t *testing.T) {
	if copySliceAny(nil) != nil {
		t.Error("expected nil for nil input")
	}
}

// --- copyMapAny: nested slices ---

func TestCopyMapAnyNestedSlice(t *testing.T) {
	m := map[string]any{
		"items":  []any{"a", "b"},
		"nested": map[string]any{"inner": []any{1, 2}},
		"plain":  "str",
	}
	c := copyMapAny(m)

	// Mutate original
	m["items"].([]any)[0] = "mutated"
	m["nested"].(map[string]any)["inner"].([]any)[0] = 999

	if c["items"].([]any)[0] != "a" {
		t.Error("slice in map was mutated")
	}
	if c["nested"].(map[string]any)["inner"].([]any)[0] != 1 {
		t.Error("nested slice was mutated")
	}
}

func TestCopyMapAnyNil(t *testing.T) {
	if copyMapAny(nil) != nil {
		t.Error("expected nil for nil input")
	}
}

// --- BuildContainerEnv: token with unrecognized prefix ---

func TestBuildContainerEnvUnrecognizedTokenPrefix(t *testing.T) {
	// We need a secrets file with a token that has an unrecognized prefix
	tmpDir := t.TempDir()
	secretsPath := filepath.Join(tmpDir, "secrets.yml")
	content := "tokens:\n  custom:\n    mykey: xyztoken123\n"
	if err := os.WriteFile(secretsPath, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	// Override DefaultSecretsPath to return our test path
	// Since we can't do that easily without modifying source, we'll test DetectTokenEnvVar directly
	envKey, envVal := DetectTokenEnvVar("xyztoken123")
	if envKey != "" {
		t.Errorf("envKey = %q, want empty for unrecognized prefix", envKey)
	}
	if envVal != "xyztoken123" {
		t.Errorf("envVal = %q", envVal)
	}
}

// --- resolveCredentialMount: missing host dir ---

func TestResolveCredentialMountMissingDir(t *testing.T) {
	// The test user likely has ~/.claude/ and ~/.codex/,
	// but we can test with a mock by using the "claude" backend
	// and setting HOME to a temp dir
	home := t.TempDir()
	t.Setenv("HOME", home)

	_, err := resolveCredentialMount("claude")
	if err == nil {
		t.Error("expected error for missing credentials dir")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q", err)
	}
}

// --- Endpoint: hostAddr branch ---
// Testing with extractHost directly since we can't easily create a tcp:// Docker client

func TestExtractHostRemote(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"tcp://remote:2375", "remote"},
		{"tcp://192.168.1.5:2375", "192.168.1.5"},
		{"tcp://localhost:2375", ""},
		{"tcp://127.0.0.1:2375", ""},
		{"unix:///var/run/docker.sock", ""},
		{"/var/run/docker.sock", ""},
		{"tcp://::1:2375", ""},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := extractHost(tt.input)
			if got != tt.want {
				t.Errorf("extractHost(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// --- DefaultSecretsPath ---

func TestDefaultSecretsPathMax(t *testing.T) {
	path, err := DefaultSecretsPath()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(path, filepath.Join(".mecha", "secrets.yml")) {
		t.Errorf("path = %q", path)
	}
}

// --- CurrentUser ---

func TestCurrentUserMax(t *testing.T) {
	user, err := CurrentUser()
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(user, ":")
	if len(parts) != 2 {
		t.Errorf("CurrentUser() = %q, want uid:gid format", user)
	}
}

// --- parseMemory ---

func TestParseMemoryVariants(t *testing.T) {
	tests := []struct {
		input   string
		want    int64
		wantErr bool
	}{
		{"8G", 8 * 1024 * 1024 * 1024, false},
		{"512M", 512 * 1024 * 1024, false},
		{"1g", 1 * 1024 * 1024 * 1024, false},
		{"256m", 256 * 1024 * 1024, false},
		{"x", 0, true},     // too short
		{"0G", 0, true},    // zero
		{"-1G", 0, true},   // negative
		{"10K", 0, true},   // unknown unit
		{"abcG", 0, true},  // bad number
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := parseMemory(tt.input)
			if tt.wantErr && err == nil {
				t.Error("expected error")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("parseMemory(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

// --- Reload: error from load ---

func TestReloadClosedDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg, err := NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}

	db.Close()

	err = reg.Reload()
	if err == nil {
		t.Error("expected error from closed DB in Reload")
	}
}

// --- BuildContainerEnv: plugins and marketplaces ---

func TestBuildContainerEnvPluginsMax(t *testing.T) {
	dc := &DockerConfig{
		Plugins:            []string{"plugin-a", "plugin-b"},
		PluginMarketplaces: []string{"https://marketplace.example.com"},
	}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if env["CLAUDE_PLUGINS"] != "plugin-a\nplugin-b" {
		t.Errorf("CLAUDE_PLUGINS = %q", env["CLAUDE_PLUGINS"])
	}
	if env["CLAUDE_PLUGIN_MARKETPLACES"] != "https://marketplace.example.com" {
		t.Errorf("CLAUDE_PLUGIN_MARKETPLACES = %q", env["CLAUDE_PLUGIN_MARKETPLACES"])
	}
}

// --- BuildContainerEnv: APIKey ---

func TestBuildContainerEnvAPIKeyMax(t *testing.T) {
	dc := &DockerConfig{
		APIKey: "my-key",
	}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if env["WORKER_API_KEY"] != "my-key" {
		t.Errorf("WORKER_API_KEY = %q", env["WORKER_API_KEY"])
	}
}

// --- BuildContainerEnv: validate callback error ---

func TestBuildContainerEnvValidateErrorMax(t *testing.T) {
	dc := &DockerConfig{
		Env: map[string]string{"WORKER_API_KEY": "val"},
	}
	_, err := BuildContainerEnv(dc, func(k, v string) error {
		if strings.HasPrefix(strings.ToLower(k), "worker_") {
			return &maxValidationError{msg: "reserved key: " + k}
		}
		return nil
	})
	if err == nil {
		t.Error("expected error from validate callback")
	}
}

type maxValidationError struct{ msg string }

func (e *maxValidationError) Error() string { return e.msg }

// --- BuildContainerEnv: no credentials, HOME defaults to /tmp ---

func TestBuildContainerEnvDefaultHome(t *testing.T) {
	dc := &DockerConfig{}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if env["HOME"] != "/tmp" {
		t.Errorf("HOME = %q, want /tmp", env["HOME"])
	}
}

// --- DetectTokenEnvVar: all prefix types ---

func TestDetectTokenEnvVarAllPrefixes(t *testing.T) {
	tests := []struct {
		token   string
		wantKey string
	}{
		{"sk-ant-oat01-xxx", "CLAUDE_CODE_OAUTH_TOKEN"},
		{"sk-ant-api-xxx", "ANTHROPIC_API_KEY"},
		{"sk-xxx", "CODEX_API_KEY"},
		{"unknown-prefix", ""},
	}
	for _, tt := range tests {
		t.Run(tt.token, func(t *testing.T) {
			key, val := DetectTokenEnvVar(tt.token)
			if key != tt.wantKey {
				t.Errorf("key = %q, want %q", key, tt.wantKey)
			}
			if val != tt.token {
				t.Errorf("val = %q, want %q", val, tt.token)
			}
		})
	}
}
