package worker

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Worker struct {
	Name     string        `yaml:"name"`
	Endpoint string        `yaml:"endpoint,omitempty"`
	Docker   *DockerConfig `yaml:"docker,omitempty"`
	Timeout  time.Duration `yaml:"timeout,omitempty"`
}

type DockerConfig struct {
	Image     string            `yaml:"image"`
	Host      string            `yaml:"host,omitempty"`
	Cwd       string            `yaml:"cwd,omitempty"`
	Resources ResourceConfig    `yaml:"resources,omitempty"`
	Lifecycle string            `yaml:"lifecycle,omitempty"`
	Port      int               `yaml:"port,omitempty"`
	Env       map[string]string `yaml:"env,omitempty"`
	Token     string            `yaml:"token,omitempty"`
	Egress    []string          `yaml:"egress,omitempty"`
	Labels    map[string]string `yaml:"labels,omitempty"`
	Network   string            `yaml:"network,omitempty"`
}

type ResourceConfig struct {
	CPU    int    `yaml:"cpu,omitempty"`
	Memory string `yaml:"memory,omitempty"`
	Pids   int    `yaml:"pids,omitempty"`
}

func (w *Worker) IsManaged() bool { return w.Docker != nil }

func (w *Worker) TypeLabel() string {
	if w.IsManaged() {
		return "managed"
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

var validLifecycles = map[string]bool{"disposable": true, "persistent": true}

func (w *Worker) validate() error {
	if w.Name == "" {
		return fmt.Errorf("name is required")
	}
	if w.Endpoint == "" && w.Docker == nil {
		return fmt.Errorf("endpoint or docker section is required")
	}
	if w.Timeout < 0 {
		return fmt.Errorf("timeout must be non-negative")
	}
	if w.Docker != nil {
		if err := w.Docker.validate(); err != nil {
			return err
		}
	}
	return nil
}

func (d *DockerConfig) validate() error {
	if d.Image == "" {
		return fmt.Errorf("docker.image is required")
	}
	if d.Lifecycle != "" && !validLifecycles[d.Lifecycle] {
		return fmt.Errorf("docker.lifecycle must be disposable or persistent, got %q", d.Lifecycle)
	}
	if d.Port < 0 {
		return fmt.Errorf("docker.port must be non-negative")
	}
	if d.Cwd != "" {
		if _, err := os.Stat(d.Cwd); err != nil {
			return fmt.Errorf("docker.cwd %q: %w", d.Cwd, err)
		}
	}
	return nil
}

func (w *Worker) applyDefaults() {
	if w.Timeout == 0 {
		w.Timeout = 10 * time.Minute
	}
	if w.Docker != nil {
		if w.Docker.Lifecycle == "" {
			w.Docker.Lifecycle = "persistent"
		}
		if w.Docker.Port == 0 {
			w.Docker.Port = 8080
		}
	}
}
