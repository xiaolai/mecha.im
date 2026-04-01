package worker

import (
	"testing"
	"time"
)

func TestDeepCopyStartedAt(t *testing.T) {
	now := time.Now()
	e := &Entry{
		Worker:    &Worker{Name: "w1"},
		State:     StateOnline,
		StartedAt: &now,
	}
	cp := deepCopyEntry(e)

	// Mutate the copy
	mutated := time.Now().Add(time.Hour)
	cp.StartedAt = &mutated

	// Original must be unchanged
	if !e.StartedAt.Equal(now) {
		t.Errorf("original StartedAt changed: %v", e.StartedAt)
	}
}

func TestDeepCopyCredentials(t *testing.T) {
	e := &Entry{
		Worker: &Worker{
			Name: "w1",
			Docker: &DockerConfig{
				Image:       "x",
				Credentials: []string{"claude", "codex"},
			},
		},
		State: StateOffline,
	}
	cp := deepCopyEntry(e)

	// Mutate the copy's credentials slice
	cp.Worker.Docker.Credentials[0] = "hacked"
	cp.Worker.Docker.Credentials = append(cp.Worker.Docker.Credentials, "extra")

	// Original must be unchanged
	if e.Worker.Docker.Credentials[0] != "claude" {
		t.Errorf("original Credentials[0] = %q, want claude", e.Worker.Docker.Credentials[0])
	}
	if len(e.Worker.Docker.Credentials) != 2 {
		t.Errorf("original Credentials len = %d, want 2", len(e.Worker.Docker.Credentials))
	}
}

func TestDeepCopyPlugins(t *testing.T) {
	e := &Entry{
		Worker: &Worker{
			Name: "w1",
			Docker: &DockerConfig{
				Image:              "x",
				Plugins:            []string{"plugin-a"},
				PluginMarketplaces: []string{"https://example.com/mp.git"},
			},
		},
		State: StateOffline,
	}
	cp := deepCopyEntry(e)

	cp.Worker.Docker.Plugins[0] = "hacked"
	cp.Worker.Docker.PluginMarketplaces[0] = "hacked"

	if e.Worker.Docker.Plugins[0] != "plugin-a" {
		t.Errorf("original Plugins[0] = %q", e.Worker.Docker.Plugins[0])
	}
	if e.Worker.Docker.PluginMarketplaces[0] != "https://example.com/mp.git" {
		t.Errorf("original PluginMarketplaces[0] = %q", e.Worker.Docker.PluginMarketplaces[0])
	}
}

func TestDeepCopyPolicyNested(t *testing.T) {
	e := &Entry{
		Worker: &Worker{
			Name: "w1",
			Policy: map[string]any{
				"rules": map[string]any{
					"allow": []any{"read", "write"},
				},
			},
		},
		State: StateOffline,
	}
	cp := deepCopyEntry(e)

	// Mutate nested map in the copy
	rules := cp.Worker.Policy["rules"].(map[string]any)
	rules["allow"] = []any{"hacked"}

	// Original must be unchanged
	origRules := e.Worker.Policy["rules"].(map[string]any)
	origAllow := origRules["allow"].([]any)
	if len(origAllow) != 2 {
		t.Errorf("original allow len = %d, want 2", len(origAllow))
	}
	if origAllow[0] != "read" {
		t.Errorf("original allow[0] = %v, want read", origAllow[0])
	}
}

func TestDeepCopyEnvMap(t *testing.T) {
	e := &Entry{
		Worker: &Worker{
			Name: "w1",
			Docker: &DockerConfig{
				Image: "x",
				Env:   map[string]string{"KEY": "value"},
			},
		},
		State: StateOffline,
	}
	cp := deepCopyEntry(e)

	cp.Worker.Docker.Env["KEY"] = "hacked"
	cp.Worker.Docker.Env["NEW"] = "injected"

	if e.Worker.Docker.Env["KEY"] != "value" {
		t.Errorf("original Env[KEY] = %q", e.Worker.Docker.Env["KEY"])
	}
	if _, ok := e.Worker.Docker.Env["NEW"]; ok {
		t.Error("original Env has injected key NEW")
	}
}

func TestDeepCopyNilFields(t *testing.T) {
	e := &Entry{
		Worker: &Worker{
			Name:   "w1",
			Docker: nil,
			Policy: nil,
		},
		State:     StateOffline,
		StartedAt: nil,
	}
	cp := deepCopyEntry(e)
	if cp.StartedAt != nil || cp.Worker.Docker != nil || cp.Worker.Policy != nil {
		t.Error("nil fields should remain nil in copy")
	}
}
