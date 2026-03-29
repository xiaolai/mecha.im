package worker

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type Secrets struct {
	Tokens map[string]map[string]string `yaml:"tokens"`
	GitHub struct {
		Token string `yaml:"token"`
	} `yaml:"github"`
}

func LoadSecrets(path string) (*Secrets, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Secrets{}, nil
		}
		return nil, fmt.Errorf("read secrets: %w", err)
	}
	info, err := os.Stat(path)
	if err == nil && info.Mode().Perm()&0o077 != 0 {
		fmt.Fprintf(os.Stderr, "warning: %s has open permissions (want 0600)\n", path)
	}
	var s Secrets
	if err := yaml.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("parse secrets: %w", err)
	}
	return &s, nil
}

func DefaultSecretsPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".mecha", "secrets.yml")
}

func (s *Secrets) Resolve(ref string) (string, error) {
	if s == nil || s.Tokens == nil {
		return "", fmt.Errorf("no secrets loaded")
	}
	parts := strings.SplitN(ref, ".", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid token ref %q (want backend.name)", ref)
	}
	backend, name := parts[0], parts[1]
	group, ok := s.Tokens[backend]
	if !ok {
		return "", fmt.Errorf("no tokens for backend %q", backend)
	}
	val, ok := group[name]
	if !ok {
		return "", fmt.Errorf("token %q not found in %q", name, backend)
	}
	return val, nil
}

func DetectTokenEnvVar(token string) (string, string) {
	switch {
	case strings.HasPrefix(token, "sk-ant-oat"):
		return "CLAUDE_CODE_OAUTH_TOKEN", token
	case strings.HasPrefix(token, "sk-ant-"):
		return "ANTHROPIC_API_KEY", token
	case strings.HasPrefix(token, "sk-"):
		return "OPENAI_API_KEY", token
	case strings.HasPrefix(token, "AIza"):
		return "GEMINI_API_KEY", token
	default:
		return "", token
	}
}
