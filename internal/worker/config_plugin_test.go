package worker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadFileWithPlugins(t *testing.T) {
	yml := `name: with-plugins
docker:
  image: mecha-worker:latest
  plugins:
    - pr-review-toolkit
    - codex-toolkit
  plugin_marketplaces:
    - https://example.com/plugins.git
`
	path := filepath.Join(t.TempDir(), "w.yml")
	os.WriteFile(path, []byte(yml), 0o644)
	w, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Docker.Plugins) != 2 {
		t.Fatalf("plugins = %v, want 2 items", w.Docker.Plugins)
	}
	if w.Docker.Plugins[0] != "pr-review-toolkit" {
		t.Errorf("plugins[0] = %q", w.Docker.Plugins[0])
	}
	if w.Docker.Plugins[1] != "codex-toolkit" {
		t.Errorf("plugins[1] = %q", w.Docker.Plugins[1])
	}
	if len(w.Docker.PluginMarketplaces) != 1 {
		t.Fatalf("marketplaces = %v", w.Docker.PluginMarketplaces)
	}
}

func TestLoadFileNoPlugins(t *testing.T) {
	yml := "name: no-plugins\ndocker:\n  image: x\n"
	path := filepath.Join(t.TempDir(), "w.yml")
	os.WriteFile(path, []byte(yml), 0o644)
	w, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Docker.Plugins) != 0 {
		t.Errorf("plugins should be empty: %v", w.Docker.Plugins)
	}
	if len(w.Docker.PluginMarketplaces) != 0 {
		t.Errorf("marketplaces should be empty: %v", w.Docker.PluginMarketplaces)
	}
}
