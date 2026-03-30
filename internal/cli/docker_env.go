package cli

import (
	"fmt"
	"strings"

	"mecha.im/internal/worker"
)

func buildContainerEnv(dc *worker.DockerConfig) (map[string]string, error) {
	return worker.BuildContainerEnv(dc, validateEnvEntry)
}

func validateEnvEntry(k, v string) error {
	lower := strings.ToLower(k)
	if blockedEnvKeys[lower] {
		return fmt.Errorf("env var %q is blocked — workers must not receive GitHub credentials", k)
	}
	if reservedEnvKeys[lower] {
		return fmt.Errorf("env var %q is reserved by mecha runtime — remove from docker.env", k)
	}
	if looksLikeCredential(v) {
		return fmt.Errorf("env var %q value looks like a credential — use docker.token instead", k)
	}
	return nil
}

func buildContainerMounts(dc *worker.DockerConfig) ([]worker.MountCfg, error) {
	return worker.BuildContainerMounts(dc)
}
