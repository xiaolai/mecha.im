package workers

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Worker is the definition of a managed or unmanaged worker, parsed from YAML.
// If Docker is non-nil, the worker is managed (mecha controls its lifecycle).
// If Adapter is non-nil, the worker uses an in-process adapter for a native LLM API.
type Worker struct {
	Name     string            `yaml:"name"`
	Endpoint string            `yaml:"endpoint,omitempty"`
	Docker   *DockerConfig     `yaml:"docker,omitempty"`
	Adapter  *AdapterConfig    `yaml:"adapter,omitempty"`
	Events   []EventRule       `yaml:"events,omitempty"`
	Policy   map[string]any    `yaml:"policy,omitempty"`
	Timeout  time.Duration     `yaml:"timeout,omitempty"`
}

// AdapterConfig holds settings for an in-process LLM adapter.
type AdapterConfig struct {
	Type     string `yaml:"type"`               // "ollama" or "openai"
	Upstream string `yaml:"upstream"`            // base URL of the LLM API
	Model    string `yaml:"model"`               // model name
	APIKey   string `yaml:"api_key,omitempty"`   // API key for OpenAI-compatible endpoints
}

// DockerConfig holds Docker container settings for a managed worker.
// All fields except Image are optional.
type DockerConfig struct {
	Image       string            `yaml:"image"`
	Host        string            `yaml:"host,omitempty"`
	Cwd         string            `yaml:"cwd,omitempty"`
	Credentials []string          `yaml:"credentials,omitempty"`
	Resources   ResourceConfig    `yaml:"resources,omitempty"`
	Lifecycle   string            `yaml:"lifecycle,omitempty"`
	Env         map[string]string `yaml:"env,omitempty"`
	Token       string            `yaml:"token,omitempty"`
	APIKey             string            `yaml:"api_key,omitempty"`
	Expose             bool              `yaml:"expose,omitempty"`
	Labels             map[string]string `yaml:"labels,omitempty"`
	Plugins            []string          `yaml:"plugins,omitempty"`
	PluginMarketplaces []string          `yaml:"plugin_marketplaces,omitempty"`
}

// ResourceConfig specifies container CPU, memory, and process limits.
type ResourceConfig struct {
	CPU    int    `yaml:"cpu,omitempty"`
	Memory string `yaml:"memory,omitempty"`
	Pids   int    `yaml:"pids,omitempty"`
}

// IsManaged returns true if the worker has a Docker section (mecha controls lifecycle).
func (w *Worker) IsManaged() bool { return w.Docker != nil }

// IsAdapter returns true if the worker uses an in-process adapter.
func (w *Worker) IsAdapter() bool { return w.Adapter != nil }

// TypeLabel returns "managed" for Docker, "adapter" for adapters, or "live" for unmanaged.
func (w *Worker) TypeLabel() string {
	if w.IsManaged() {
		return "managed"
	}
	if w.IsAdapter() {
		return "adapter"
	}
	return "live"
}

var envVarPattern = regexp.MustCompile(`\$\{([^}]+)\}`)

func expandEnvVar(s string) (string, bool) {
	allResolved := true
	result := envVarPattern.ReplaceAllStringFunc(s, func(match string) string {
		key := match[2 : len(match)-1]
		if val, ok := os.LookupEnv(key); ok {
			return val
		}
		allResolved = false
		return match
	})
	return result, allResolved
}

func (w *Worker) interpolateEnv() error {
	if w.Endpoint != "" {
		val, resolved := expandEnvVar(w.Endpoint)
		if !resolved {
			return fmt.Errorf("unresolved env var in endpoint: %s", w.Endpoint)
		}
		w.Endpoint = val
	}
	// Intentionally skip proxy.key — keep as env var reference.
	if w.Docker != nil && w.Docker.Host != "" {
		val, resolved := expandEnvVar(w.Docker.Host)
		if !resolved {
			return fmt.Errorf("unresolved env var in docker.host: %s", w.Docker.Host)
		}
		w.Docker.Host = val
	}
	return nil
}

// LoadFile reads a worker YAML file, parses it with strict field checking,
// interpolates environment variables, validates, and applies defaults.
func LoadFile(path string) (*Worker, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read worker file: %w", err)
	}
	var w Worker
	dec := yaml.NewDecoder(strings.NewReader(string(data)))
	dec.KnownFields(true)
	if err := dec.Decode(&w); err != nil {
		return nil, fmt.Errorf("parse worker yaml: %w", err)
	}
	if err := w.interpolateEnv(); err != nil {
		return nil, fmt.Errorf("interpolate env: %w", err)
	}
	if err := w.validate(); err != nil {
		return nil, fmt.Errorf("validate worker: %w", err)
	}
	w.applyDefaults()
	return &w, nil
}

// LoadDir loads all .yml/.yaml files in a directory as workers.
// Non-YAML files are silently skipped. Fails on first invalid file.
func LoadDir(dir string) ([]*Worker, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read worker dir: %w", err)
	}
	var workers []*Worker
	for _, e := range entries {
		if e.IsDir() || !isYAML(e.Name()) {
			continue
		}
		w, err := LoadFile(dir + "/" + e.Name())
		if err != nil {
			return nil, fmt.Errorf("load %s: %w", e.Name(), err)
		}
		workers = append(workers, w)
	}
	return workers, nil
}

func isYAML(name string) bool {
	return strings.HasSuffix(name, ".yml") || strings.HasSuffix(name, ".yaml")
}

var validName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)

func (w *Worker) validate() error {
	if w.Name == "" {
		return fmt.Errorf("name is required")
	}
	if !validName.MatchString(w.Name) {
		return fmt.Errorf("name %q is invalid (must match [a-zA-Z0-9][a-zA-Z0-9_.-]*)", w.Name)
	}
	if w.Endpoint == "" && w.Docker == nil && w.Adapter == nil {
		return fmt.Errorf("endpoint, docker, or adapter section is required")
	}
	if w.Docker != nil && w.Adapter != nil {
		return fmt.Errorf("cannot have both docker and adapter sections")
	}
	if w.Timeout < 0 {
		return fmt.Errorf("timeout must be non-negative")
	}
	if w.Docker != nil {
		if err := w.Docker.Validate(); err != nil {
			return err
		}
	}
	if w.Adapter != nil {
		if err := w.Adapter.Validate(); err != nil {
			return err
		}
	}
	for i, rule := range w.Events {
		if err := rule.validate(i); err != nil {
			return err
		}
	}
	return nil
}

