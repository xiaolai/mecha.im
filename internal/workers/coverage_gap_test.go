package workers

import (
	"strings"
	"testing"
)

// --- 1. Sanitized() ---

func TestSanitizedDockerEnvRedacted(t *testing.T) {
	e := &Entry{
		Worker: &Worker{
			Name: "w1",
			Docker: &DockerConfig{
				Image:  "x",
				Env:    map[string]string{"SECRET": "hunter2", "TOKEN": "abc123"},
				Token:  "claude.work",
				APIKey: "my-api-key",
			},
		},
		State: StateOnline,
	}
	s := e.Sanitized()

	for k, v := range s.Worker.Docker.Env {
		if v != "***" {
			t.Errorf("Sanitized Env[%s] = %q, want ***", k, v)
		}
	}
	if s.Worker.Docker.Token != "" {
		t.Errorf("Sanitized Token = %q, want empty", s.Worker.Docker.Token)
	}
	if s.Worker.Docker.APIKey != "" {
		t.Errorf("Sanitized APIKey = %q, want empty", s.Worker.Docker.APIKey)
	}

	// Original must be unchanged
	if e.Worker.Docker.Token != "claude.work" {
		t.Error("original Token was mutated")
	}
	if e.Worker.Docker.APIKey != "my-api-key" {
		t.Error("original APIKey was mutated")
	}
}

func TestSanitizedAdapterAPIKeyRedacted(t *testing.T) {
	e := &Entry{
		Worker: &Worker{
			Name: "w1",
			Adapter: &AdapterConfig{
				Type:     "openai",
				Upstream: "http://localhost:8080",
				Model:    "gpt-4",
				APIKey:   "sk-secret",
			},
		},
		State: StateOnline,
	}
	s := e.Sanitized()

	if s.Worker.Adapter.APIKey != "" {
		t.Errorf("Sanitized Adapter.APIKey = %q, want empty", s.Worker.Adapter.APIKey)
	}
	// Original must be unchanged
	if e.Worker.Adapter.APIKey != "sk-secret" {
		t.Error("original Adapter.APIKey was mutated")
	}
}

func TestSanitizedNilWorker(t *testing.T) {
	e := &Entry{Worker: nil, State: StateOffline}
	s := e.Sanitized()
	if s.Worker != nil {
		t.Error("expected nil Worker in sanitized copy")
	}
}

func TestSanitizedNoDocker(t *testing.T) {
	e := &Entry{
		Worker: &Worker{Name: "live", Endpoint: "http://x"},
		State:  StateOnline,
	}
	s := e.Sanitized()
	if s.Worker.Endpoint != "http://x" {
		t.Errorf("Endpoint = %q", s.Worker.Endpoint)
	}
}

// --- 2. EventRule.IsAuto() ---

func TestEventRuleIsAuto(t *testing.T) {
	tests := []struct {
		name string
		auto *bool
		want bool
	}{
		{"nil defaults to true", nil, true},
		{"ptr true", ptr(true), true},
		{"ptr false", ptr(false), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := EventRule{Auto: tt.auto}
			if got := r.IsAuto(); got != tt.want {
				t.Errorf("IsAuto() = %v, want %v", got, tt.want)
			}
		})
	}
}

// --- 3. EventRule.validate() ---

func TestEventRuleValidate(t *testing.T) {
	tests := []struct {
		name    string
		rule    EventRule
		wantErr string
	}{
		{
			name:    "empty source",
			rule:    EventRule{On: []string{"push"}, Prompt: "do it"},
			wantErr: "source is required",
		},
		{
			name:    "empty on",
			rule:    EventRule{Source: "github", Prompt: "do it"},
			wantErr: "on is required",
		},
		{
			name:    "empty prompt",
			rule:    EventRule{Source: "github", On: []string{"push"}},
			wantErr: "prompt is required",
		},
		{
			name:    "invalid template",
			rule:    EventRule{Source: "github", On: []string{"push"}, Prompt: "{{ .X"},
			wantErr: "invalid template",
		},
		{
			name: "valid rule",
			rule: EventRule{Source: "github", On: []string{"push"}, Prompt: "review {{ .Subject }}"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.rule.validate(0)
			if tt.wantErr == "" {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want substring %q", err, tt.wantErr)
			}
		})
	}
}

// --- 4. AdapterConfig.Validate() ---

func TestAdapterConfigValidate(t *testing.T) {
	tests := []struct {
		name    string
		cfg     AdapterConfig
		wantErr string
	}{
		{
			name:    "empty type",
			cfg:     AdapterConfig{Upstream: "http://x", Model: "m"},
			wantErr: "adapter.type is required",
		},
		{
			name:    "unknown type",
			cfg:     AdapterConfig{Type: "vllm", Upstream: "http://x", Model: "m"},
			wantErr: "adapter.type must be ollama or openai",
		},
		{
			name:    "empty upstream",
			cfg:     AdapterConfig{Type: "ollama", Model: "m"},
			wantErr: "adapter.upstream is required",
		},
		{
			name:    "empty model",
			cfg:     AdapterConfig{Type: "ollama", Upstream: "http://x"},
			wantErr: "adapter.model is required",
		},
		{
			name: "valid ollama",
			cfg:  AdapterConfig{Type: "ollama", Upstream: "http://localhost:11434", Model: "gemma2:9b"},
		},
		{
			name: "valid openai",
			cfg:  AdapterConfig{Type: "openai", Upstream: "http://localhost:8080", Model: "gpt-4"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.Validate()
			if tt.wantErr == "" {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want substring %q", err, tt.wantErr)
			}
		})
	}
}

// --- 5. ptr() ---

func TestPtr(t *testing.T) {
	bp := ptr(true)
	if *bp != true {
		t.Errorf("ptr(true) = %v", *bp)
	}

	ip := ptr(42)
	if *ip != 42 {
		t.Errorf("ptr(42) = %v", *ip)
	}

	sp := ptr("hello")
	if *sp != "hello" {
		t.Errorf("ptr(hello) = %v", *sp)
	}
}

// --- 6. TypeLabel() — adapter branch ---

func TestTypeLabelAdapter(t *testing.T) {
	w := &Worker{
		Name:    "a",
		Adapter: &AdapterConfig{Type: "ollama", Upstream: "http://x", Model: "m"},
	}
	if w.TypeLabel() != "adapter" {
		t.Errorf("TypeLabel() = %q, want adapter", w.TypeLabel())
	}
}

// --- 7. validate() — additional branches ---

func TestValidateEmptyName(t *testing.T) {
	w := &Worker{Endpoint: "http://x"}
	err := w.validate()
	if err == nil || !strings.Contains(err.Error(), "name is required") {
		t.Errorf("error = %v", err)
	}
}

func TestValidateInvalidNameChars(t *testing.T) {
	w := &Worker{Name: "has space", Endpoint: "http://x"}
	err := w.validate()
	if err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Errorf("error = %v", err)
	}
}

func TestValidateNameStartingWithDash(t *testing.T) {
	w := &Worker{Name: "-bad", Endpoint: "http://x"}
	err := w.validate()
	if err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Errorf("error = %v", err)
	}
}

func TestValidateDockerAndAdapter(t *testing.T) {
	w := &Worker{
		Name:    "bad",
		Docker:  &DockerConfig{Image: "x"},
		Adapter: &AdapterConfig{Type: "ollama", Upstream: "http://x", Model: "m"},
	}
	err := w.validate()
	if err == nil || !strings.Contains(err.Error(), "cannot have both docker and adapter") {
		t.Errorf("error = %v", err)
	}
}

func TestValidateDockerAndEndpoint(t *testing.T) {
	// Docker+Endpoint is allowed (docker workers can have endpoint set separately),
	// but missing endpoint+docker+adapter is not.
	w := &Worker{Name: "bad"}
	err := w.validate()
	if err == nil || !strings.Contains(err.Error(), "endpoint, docker, or adapter section is required") {
		t.Errorf("error = %v", err)
	}
}

func TestValidateDockerValidateCallPath(t *testing.T) {
	// Trigger Docker.Validate error (missing image)
	w := &Worker{Name: "bad", Docker: &DockerConfig{}}
	err := w.validate()
	if err == nil || !strings.Contains(err.Error(), "docker.image is required") {
		t.Errorf("error = %v", err)
	}
}

func TestValidateAdapterValidateCallPath(t *testing.T) {
	// Trigger Adapter.Validate error (missing type)
	w := &Worker{Name: "bad", Adapter: &AdapterConfig{}}
	err := w.validate()
	if err == nil || !strings.Contains(err.Error(), "adapter.type is required") {
		t.Errorf("error = %v", err)
	}
}

func TestValidateEventRulesCallPath(t *testing.T) {
	w := &Worker{
		Name:     "ok",
		Endpoint: "http://x",
		Events:   []EventRule{{Source: "", On: []string{"push"}, Prompt: "x"}},
	}
	err := w.validate()
	if err == nil || !strings.Contains(err.Error(), "source is required") {
		t.Errorf("error = %v", err)
	}
}

// --- 8. copyEvents() ---

func TestCopyEventsNil(t *testing.T) {
	if copyEvents(nil) != nil {
		t.Error("copyEvents(nil) should return nil")
	}
}

func TestCopyEventsEmpty(t *testing.T) {
	result := copyEvents([]EventRule{})
	if result == nil || len(result) != 0 {
		t.Errorf("copyEvents([]) = %v", result)
	}
}

func TestCopyEventsWithFilterAndAuto(t *testing.T) {
	auto := true
	events := []EventRule{
		{
			Source: "github",
			On:     []string{"push"},
			Filter: map[string]string{"branch": "main"},
			Prompt: "review",
			Auto:   &auto,
		},
	}
	cp := copyEvents(events)

	// Mutate the copy
	cp[0].Filter["branch"] = "hacked"
	newAuto := false
	cp[0].Auto = &newAuto

	// Original must be unchanged
	if events[0].Filter["branch"] != "main" {
		t.Errorf("original Filter mutated: %v", events[0].Filter)
	}
	if *events[0].Auto != true {
		t.Error("original Auto was mutated")
	}
}

// --- 9. BuildContainerEnv() — Credentials HOME branch ---

func TestBuildContainerEnvCredentialsSetsHomeGap(t *testing.T) {
	dc := &DockerConfig{
		Credentials: []string{"claude"},
	}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if env["HOME"] != "/home/worker" {
		t.Errorf("HOME = %q, want /home/worker", env["HOME"])
	}
}

// --- 10. resolveCredentialMount() — unknown backend ---

func TestResolveCredentialMountUnknownBackend(t *testing.T) {
	_, err := resolveCredentialMount("gemini")
	if err == nil {
		t.Fatal("expected error for unknown backend")
	}
	if !strings.Contains(err.Error(), "unknown credentials backend") {
		t.Errorf("error = %q", err)
	}
}
