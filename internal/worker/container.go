package worker

import (
	"fmt"
	"os"
	"path/filepath"
)

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

	env["HOME"] = "/tmp"
	return env, nil
}

// BuildContainerMounts resolves docker.cwd into a bind mount configuration.
func BuildContainerMounts(dc *DockerConfig) ([]MountCfg, error) {
	var mounts []MountCfg
	if dc.Cwd != "" {
		resolved, err := filepath.EvalSymlinks(dc.Cwd)
		if err != nil {
			return nil, fmt.Errorf("resolve cwd %q: %w", dc.Cwd, err)
		}
		resolved, err = filepath.Abs(resolved)
		if err != nil {
			return nil, fmt.Errorf("abs cwd %q: %w", dc.Cwd, err)
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return nil, fmt.Errorf("stat cwd %q: %w", dc.Cwd, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("cwd %q is not a directory", dc.Cwd)
		}
		mounts = append(mounts, MountCfg{
			Source: resolved, Target: "/workspace", ReadOnly: false,
		})
	}
	return mounts, nil
}
