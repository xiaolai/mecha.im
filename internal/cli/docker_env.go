package cli

import (
	"fmt"

	"mecha.im/internal/workers"
)

func buildContainerEnv(dc *workers.DockerConfig) (map[string]string, error) {
	return workers.BuildContainerEnv(dc, validateEnvEntry)
}

func validateEnvEntry(k, v string) error {
	if isReservedEnvKey(k) {
		return fmt.Errorf("env var %q is reserved by mecha runtime — remove from docker.env", k)
	}
	return nil
}

func buildContainerMounts(dc *workers.DockerConfig) ([]workers.MountCfg, error) {
	return workers.BuildContainerMounts(dc)
}
