package cli

import (
	"testing"

	"mecha.im/internal/workers"
)

func TestNewAdapterOllama(t *testing.T) {
	ac := &workers.AdapterConfig{
		Type:     "ollama",
		Upstream: "http://localhost:11434",
		Model:    "gemma2:9b",
	}
	a, err := newAdapter(ac)
	if err != nil {
		t.Fatalf("newAdapter ollama: %v", err)
	}
	if a.Name() != "ollama" {
		t.Errorf("Name() = %q, want 'ollama'", a.Name())
	}
}

func TestNewAdapterOpenAI(t *testing.T) {
	ac := &workers.AdapterConfig{
		Type:     "openai",
		Upstream: "http://localhost:8080",
		Model:    "gpt-4",
		APIKey:   "sk-test",
	}
	a, err := newAdapter(ac)
	if err != nil {
		t.Fatalf("newAdapter openai: %v", err)
	}
	if a.Name() != "openai" {
		t.Errorf("Name() = %q, want 'openai'", a.Name())
	}
}

func TestNewAdapterUnknown(t *testing.T) {
	ac := &workers.AdapterConfig{
		Type:     "vllm",
		Upstream: "http://localhost:8000",
		Model:    "llama-3",
	}
	_, err := newAdapter(ac)
	if err == nil {
		t.Fatal("expected error for unknown adapter type")
	}
	if got := err.Error(); got != "unknown adapter type: vllm" {
		t.Errorf("error = %q, want 'unknown adapter type: vllm'", got)
	}
}

func TestNewAdapterKnownTypes(t *testing.T) {
	tests := []struct {
		adapterType string
		wantName    string
	}{
		{"ollama", "ollama"},
		{"openai", "openai"},
	}
	for _, tt := range tests {
		t.Run(tt.adapterType, func(t *testing.T) {
			ac := &workers.AdapterConfig{
				Type:     tt.adapterType,
				Upstream: "http://localhost:1234",
				Model:    "test-model",
			}
			a, err := newAdapter(ac)
			if err != nil {
				t.Fatalf("newAdapter(%s): %v", tt.adapterType, err)
			}
			if a.Name() != tt.wantName {
				t.Errorf("Name() = %q, want %q", a.Name(), tt.wantName)
			}
		})
	}
}

func TestAdapterStopNoRunner(t *testing.T) {
	// adapterStop with a name that has no runner should not panic
	adapterStop("nonexistent-worker")
}

func TestAdapterStopIdempotent(t *testing.T) {
	// Calling stop twice on a nonexistent runner should be safe
	adapterStop("phantom")
	adapterStop("phantom")
}

func TestAdapterRunnersMapCleanup(t *testing.T) {
	// Manually insert a nil runner entry, verify stop handles it
	adapterRunnersMu.Lock()
	adapterRunners["nil-runner"] = nil
	adapterRunnersMu.Unlock()

	// Should not panic even with nil runner
	adapterStop("nil-runner")

	adapterRunnersMu.Lock()
	_, exists := adapterRunners["nil-runner"]
	adapterRunnersMu.Unlock()
	if exists {
		t.Error("nil-runner should have been removed from map")
	}
}
