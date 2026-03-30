package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"mecha.im/internal/worker"
)

func buildContainerEnv(dc *worker.DockerConfig) (map[string]string, error) {
	env := make(map[string]string)

	// 1. Resolve token → fail if set but unresolvable.
	if dc.Token != "" {
		secretsPath, err := worker.DefaultSecretsPath()
		if err != nil {
			return nil, fmt.Errorf("resolve secrets path: %w", err)
		}
		secrets, err := worker.LoadSecrets(secretsPath)
		if err != nil {
			return nil, fmt.Errorf("load secrets for token %q: %w", dc.Token, err)
		}
		tokenVal, err := secrets.Resolve(dc.Token)
		if err != nil {
			return nil, fmt.Errorf("resolve token %q: %w", dc.Token, err)
		}
		envKey, envVal := worker.DetectTokenEnvVar(tokenVal)
		if envKey == "" {
			return nil, fmt.Errorf("unknown token format for %q", dc.Token)
		}
		env[envKey] = envVal
	}

	// 2. Merge explicit env (wins on collision). Block GitHub tokens.
	for k, v := range dc.Env {
		if blockedEnvKeys[strings.ToLower(k)] {
			return nil, fmt.Errorf("env var %q is blocked — workers must not receive GitHub credentials", k)
		}
		if looksLikeCredential(v) {
			return nil, fmt.Errorf("env var %q value looks like a credential — use docker.token instead", k)
		}
		env[k] = v
	}

	// 3. API key for worker authentication.
	if dc.APIKey != "" {
		env["WORKER_API_KEY"] = dc.APIKey
	}

	// 4. Domain for Caddy HTTPS.
	if dc.Domain != "" {
		env["WORKER_DOMAIN"] = dc.Domain
	}

	// 5. HOME for non-root user.
	env["HOME"] = "/tmp"
	return env, nil
}

func buildContainerMounts(dc *worker.DockerConfig) ([]worker.MountCfg, error) {
	var mounts []worker.MountCfg
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
		mounts = append(mounts, worker.MountCfg{
			Source: resolved, Target: "/workspace", ReadOnly: false,
		})
	}
	return mounts, nil
}
