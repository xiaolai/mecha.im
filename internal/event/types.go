package event

import (
	"encoding/json"
	"time"
)

// State represents an event's lifecycle state.
type State string

const (
	StateReceived  State = "received"
	StateMatched   State = "matched"
	StateDispatched State = "dispatched"
	StateCompleted State = "completed"
	StateFailed    State = "failed"
	StateSkipped   State = "skipped"
)

// Payload is a map of enriched fields available to prompt templates.
type Payload map[string]any

// Event is something that happened from an external source.
type Event struct {
	ID         string          `json:"id"`
	DeliveryID string          `json:"delivery_id"`
	Source     string          `json:"source"`
	Type       string          `json:"type"`
	RepoOwner  string          `json:"repo_owner"`
	RepoName   string          `json:"repo_name"`
	Ref        string          `json:"ref"`
	Number     int             `json:"number"`
	Sender     string          `json:"sender"`
	Payload    Payload         `json:"payload"`
	Raw        json.RawMessage `json:"raw,omitempty"`
	State      State           `json:"state"`
	WorkerName string          `json:"worker_name,omitempty"`
	TaskID     string          `json:"task_id,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}
