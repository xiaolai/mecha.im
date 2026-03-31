package worker

import "fmt"

// BuildSSHEnv assembles environment variables for an SSH worker.
// Resolves token references from secrets, merges ssh.env.
func BuildSSHEnv(sc *SSHConfig) (map[string]string, error) {
	env := make(map[string]string)

	if sc.Token != "" {
		secretsPath, err := DefaultSecretsPath()
		if err != nil {
			return nil, fmt.Errorf("resolve secrets path: %w", err)
		}
		secrets, err := LoadSecrets(secretsPath)
		if err != nil {
			return nil, fmt.Errorf("load secrets for token %q: %w", sc.Token, err)
		}
		tokenVal, err := secrets.Resolve(sc.Token)
		if err != nil {
			return nil, fmt.Errorf("resolve token %q: %w", sc.Token, err)
		}
		envKey, envVal := DetectTokenEnvVar(tokenVal)
		if envKey == "" {
			return nil, fmt.Errorf("unknown token format for %q", sc.Token)
		}
		env[envKey] = envVal
	}

	for k, v := range sc.Env {
		env[k] = v
	}
	return env, nil
}
