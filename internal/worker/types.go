package worker

import "time"

// State represents a worker's lifecycle state.
type State string

const (
	// StateOffline means the worker definition exists but nothing is running.
	StateOffline State = "offline"
	// StateOnline means the worker is healthy and accepting tasks.
	StateOnline State = "online"
	// StateBusy means the worker is executing a task (tracked in-container, Phase 3).
	StateBusy State = "busy"
	// StateError means the health check failed or the container exited.
	StateError State = "error"
)

// Entry combines a worker definition with its runtime state in the registry.
type Entry struct {
	Worker          *Worker    `json:"worker"`
	State           State      `json:"state"`
	Error           string     `json:"error,omitempty"`
	StartedAt       *time.Time `json:"started_at,omitempty"`
	ContainerID     string     `json:"container_id,omitempty"`
	RuntimeEndpoint string     `json:"runtime_endpoint,omitempty"`
}
