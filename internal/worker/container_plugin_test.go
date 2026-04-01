package worker

import (
	"strings"
	"testing"
)

func TestBuildContainerEnvPlugins(t *testing.T) {
	dc := &DockerConfig{
		Plugins:            []string{"pr-review-toolkit", "codex-toolkit"},
		PluginMarketplaces: []string{"https://example.com/plugins.git"},
	}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}

	plugins := env["CLAUDE_PLUGINS"]
	if plugins == "" {
		t.Fatal("CLAUDE_PLUGINS not set")
	}
	parts := strings.Split(plugins, "\n")
	if len(parts) != 2 {
		t.Fatalf("CLAUDE_PLUGINS has %d entries, want 2", len(parts))
	}
	if parts[0] != "pr-review-toolkit" || parts[1] != "codex-toolkit" {
		t.Errorf("CLAUDE_PLUGINS = %q", plugins)
	}

	mps := env["CLAUDE_PLUGIN_MARKETPLACES"]
	if mps == "" {
		t.Fatal("CLAUDE_PLUGIN_MARKETPLACES not set")
	}
	if mps != "https://example.com/plugins.git" {
		t.Errorf("CLAUDE_PLUGIN_MARKETPLACES = %q", mps)
	}
}

func TestBuildContainerEnvNoPlugins(t *testing.T) {
	dc := &DockerConfig{}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := env["CLAUDE_PLUGINS"]; ok {
		t.Error("CLAUDE_PLUGINS should not be set when no plugins configured")
	}
	if _, ok := env["CLAUDE_PLUGIN_MARKETPLACES"]; ok {
		t.Error("CLAUDE_PLUGIN_MARKETPLACES should not be set when empty")
	}
}
