package cli

import (
	"fmt"

	"mecha.im/internal/worker"
)

func buildContainerEnv(dc *worker.DockerConfig) (map[string]string, error) {
	return worker.BuildContainerEnv(dc, validateEnvEntry)
}

func validateEnvEntry(k, v string) error {
	if isReservedEnvKey(k) {
		return fmt.Errorf("env var %q is reserved by mecha runtime — remove from docker.env", k)
	}
	return nil
}

func buildContainerMounts(dc *worker.DockerConfig) ([]worker.MountCfg, error) {
	return worker.BuildContainerMounts(dc)
}
