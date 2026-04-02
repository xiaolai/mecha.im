package workers

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

const defaultAddr = "127.0.0.1:21212"

// ServerConfig holds mecha server configuration loaded from ~/.mecha/config.yml.
type ServerConfig struct {
	Addr   string `yaml:"addr"`    // listen address (default: 127.0.0.1:21212)
	APIKey string `yaml:"api_key"` // server API key (default: empty, no auth)
}

// DefaultServerConfig returns configuration with sensible defaults.
func DefaultServerConfig() ServerConfig {
	return ServerConfig{Addr: defaultAddr}
}

// LoadServerConfig reads ~/.mecha/config.yml. Returns defaults if file is missing.
func LoadServerConfig() (ServerConfig, error) {
	cfg := DefaultServerConfig()
	path, err := defaultConfigPath()
	if err != nil {
		return cfg, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, fmt.Errorf("read config: %w", err)
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("parse config %s: %w", path, err)
	}
	if cfg.Addr == "" {
		cfg.Addr = defaultAddr
	}
	return cfg, nil
}

func defaultConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".mecha", "config.yml"), nil
}
