package worker

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// credentialMount defines a host→container bind mount for CLI subscription auth.
type credentialMount struct {
	HostDir      string // relative to $HOME
	ContainerDir string // absolute path in container
}

// credentialMounts maps backend names to their credential file locations.
// These are read-only mounts for subscription-based CLI auth.
// Gemini is excluded: its credential file (~/.gemini/gemini-credentials.json)
// is AES-256-GCM encrypted with scrypt(hostname+username), not portable
// into containers. Use Gemini API endpoints as unmanaged workers instead.
var credentialMounts = map[string]credentialMount{
	"claude": {HostDir: ".claude", ContainerDir: "/home/worker/.claude"},
	"codex":  {HostDir: ".codex", ContainerDir: "/home/worker/.codex"},
}

// BuildContainerEnv assembles environment variables for a managed worker container.
// Resolves token references from secrets, merges docker.env, sets HOME.
// The validate function is called for each user-provided env key/value to enforce
// blocklist and credential checks (injected by the caller).
func BuildContainerEnv(dc *DockerConfig, validate func(k, v string) error) (map[string]string, error) {
	env := make(map[string]string)

	if dc.Token != "" {
		secretsPath, err := DefaultSecretsPath()
		if err != nil {
			return nil, fmt.Errorf("resolve secrets path: %w", err)
		}
		secrets, err := LoadSecrets(secretsPath)
		if err != nil {
			return nil, fmt.Errorf("load secrets for token %q: %w", dc.Token, err)
		}
		tokenVal, err := secrets.Resolve(dc.Token)
		if err != nil {
			return nil, fmt.Errorf("resolve token %q: %w", dc.Token, err)
		}
		envKey, envVal := DetectTokenEnvVar(tokenVal)
		if envKey == "" {
			return nil, fmt.Errorf("unknown token format for %q", dc.Token)
		}
		env[envKey] = envVal
	}

	for k, v := range dc.Env {
		if validate != nil {
			if err := validate(k, v); err != nil {
				return nil, err
			}
		}
		env[k] = v
	}

	if dc.APIKey != "" {
		env["WORKER_API_KEY"] = dc.APIKey
	}

	if len(dc.Credentials) > 0 {
		env["HOME"] = "/home/worker"
	} else {
		env["HOME"] = "/tmp"
	}

	if len(dc.Plugins) > 0 {
		env["CLAUDE_PLUGINS"] = strings.Join(dc.Plugins, "\n")
	}
	if len(dc.PluginMarketplaces) > 0 {
		env["CLAUDE_PLUGIN_MARKETPLACES"] = strings.Join(dc.PluginMarketplaces, "\n")
	}

	return env, nil
}

// ResolveCwd canonicalizes a cwd path: resolves symlinks, makes absolute,
// verifies it exists and is a directory. Used by both validation and mount building.
func ResolveCwd(cwd string) (string, error) {
	resolved, err := filepath.EvalSymlinks(cwd)
	if err != nil {
		return "", fmt.Errorf("resolve cwd %q: %w", cwd, err)
	}
	resolved, err = filepath.Abs(resolved)
	if err != nil {
		return "", fmt.Errorf("abs cwd %q: %w", cwd, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("stat cwd %q: %w", cwd, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("cwd %q is not a directory", cwd)
	}
	return resolved, nil
}

// BuildContainerMounts resolves docker.cwd and docker.credentials into bind mounts.
func BuildContainerMounts(dc *DockerConfig) ([]MountCfg, error) {
	var mounts []MountCfg
	if dc.Cwd != "" {
		resolved, err := ResolveCwd(dc.Cwd)
		if err != nil {
			return nil, err
		}
		mounts = append(mounts, MountCfg{
			Source: resolved, Target: "/workspace", ReadOnly: false,
		})
	}
	for _, cred := range dc.Credentials {
		m, err := resolveCredentialMount(cred)
		if err != nil {
			return nil, err
		}
		mounts = append(mounts, m)
	}
	return mounts, nil
}

// resolveCredentialMount maps a backend name to a read-only bind mount.
func resolveCredentialMount(backend string) (MountCfg, error) {
	cm, ok := credentialMounts[backend]
	if !ok {
		return MountCfg{}, fmt.Errorf("unknown credentials backend %q (want claude or codex)", backend)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return MountCfg{}, fmt.Errorf("resolve home dir for credentials: %w", err)
	}
	hostPath := filepath.Join(home, cm.HostDir)
	if _, err := os.Stat(hostPath); err != nil {
		return MountCfg{}, fmt.Errorf("credentials dir %q not found — run the %s CLI to authenticate first", hostPath, backend)
	}
	return MountCfg{
		Source:   hostPath,
		Target:   cm.ContainerDir,
		ReadOnly: true,
	}, nil
}
