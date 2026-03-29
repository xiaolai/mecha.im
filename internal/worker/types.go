package worker

import "time"

type State string

const (
	StateOffline State = "offline"
	StateOnline  State = "online"
	StateBusy    State = "busy"
	StateError   State = "error"
)

type Entry struct {
	Worker          *Worker    `json:"worker"`
	State           State      `json:"state"`
	Error           string     `json:"error,omitempty"`
	StartedAt       *time.Time `json:"started_at,omitempty"`
	ContainerID     string     `json:"container_id,omitempty"`
	RuntimeEndpoint string     `json:"runtime_endpoint,omitempty"`
}
