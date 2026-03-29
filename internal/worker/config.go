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
	Image     string         `yaml:"image"`
	Host      string         `yaml:"host,omitempty"`
	Resources ResourceConfig `yaml:"resources,omitempty"`
	Lifecycle string         `yaml:"lifecycle,omitempty"`
	Port      int            `yaml:"port,omitempty"`
	Proxy     *ProxyConfig   `yaml:"proxy,omitempty"`
	Egress    []string       `yaml:"egress,omitempty"`
}

type ResourceConfig struct {
	CPU    int    `yaml:"cpu,omitempty"`
	Memory string `yaml:"memory,omitempty"`
	Pids   int    `yaml:"pids,omitempty"`
}

type ProxyConfig struct {
	Target string `yaml:"target"`
	Key    string `yaml:"key"`
}

func (w *Worker) IsManaged() bool { return w.Docker != nil }

func (w *Worker) TypeLabel() string {
	if w.IsManaged() {
		return "managed"
	}
	return "live"
}

var envVarPattern = regexp.MustCompile(`\$\{([^}]+)\}`)

func expandEnvVar(s string) string {
	return envVarPattern.ReplaceAllStringFunc(s, func(match string) string {
		key := match[2 : len(match)-1]
		if val, ok := os.LookupEnv(key); ok {
			return val
		}
		return match
	})
}

func (w *Worker) interpolateEnv() {
	w.Endpoint = expandEnvVar(w.Endpoint)
	// Intentionally skip proxy.key — keep as env var reference.
	if w.Docker != nil && w.Docker.Host != "" {
		w.Docker.Host = expandEnvVar(w.Docker.Host)
	}
}

func LoadFile(path string) (*Worker, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read worker file: %w", err)
	}
	var w Worker
	if err := yaml.Unmarshal(data, &w); err != nil {
		return nil, fmt.Errorf("parse worker yaml: %w", err)
	}
	w.interpolateEnv()
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

func (w *Worker) validate() error {
	if w.Name == "" {
		return fmt.Errorf("name is required")
	}
	if w.Endpoint == "" && w.Docker == nil {
		return fmt.Errorf("endpoint or docker section is required")
	}
	if w.Docker != nil && w.Docker.Image == "" {
		return fmt.Errorf("docker.image is required")
	}
	return nil
}

func (w *Worker) applyDefaults() {
	if w.Timeout == 0 {
		w.Timeout = 10 * time.Minute
	}
	if w.Docker != nil {
		if w.Docker.Lifecycle == "" {
			w.Docker.Lifecycle = "disposable"
		}
		if w.Docker.Port == 0 {
			w.Docker.Port = 8080
		}
	}
}
