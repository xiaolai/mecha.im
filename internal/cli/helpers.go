package cli

import "strings"

// reservedEnvKeys are set by mecha runtime and must not be overridden via docker.env.
var reservedEnvKeys = map[string]bool{
	"worker_backend": true, "worker_port": true,
	"worker_api_key": true, "worker_timeout": true,
	"worker_dry_run": true, "home": true,
}

// isReservedEnvKey checks if a key (case-insensitive) is reserved by the runtime.
func isReservedEnvKey(k string) bool {
	return reservedEnvKeys[strings.ToLower(k)]
}
