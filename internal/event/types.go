package event

import (
	"encoding/json"
	"time"
)

// State represents an event's lifecycle state.
type State string

const (
	// StateReceived means the event arrived and was persisted, not yet matched.
	StateReceived State = "received"
	// StateMatched means the event matched a worker by event rules.
	StateMatched State = "matched"
	// StateDispatched means a task was created and sent to a worker.
	StateDispatched State = "dispatched"
	// StateCompleted means the worker returned a result and write-back succeeded.
	StateCompleted State = "completed"
	// StateFailed means processing errored or timed out.
	StateFailed State = "failed"
	// StateSkipped means no matching worker was found for this event.
	StateSkipped State = "skipped"
)

// Attrs holds provider-specific fields available to prompt templates.
type Attrs map[string]any

// Event is something that happened from an external source.
// All provider-specific data lives in Attrs — the struct itself
// contains only universal, provider-neutral fields.
type Event struct {
	ID         string          `json:"id"`
	DeliveryID string          `json:"delivery_id"`
	DedupKey   string          `json:"dedup_key,omitempty"` // reserved for semantic dedup (cron/polling); not yet enforced
	Source     string          `json:"source"`
	Type       string          `json:"type"`
	Actor      string          `json:"actor"`
	Subject    string          `json:"subject"`
	Attrs      Attrs           `json:"attrs"`
	Raw        json.RawMessage `json:"raw,omitempty"`
	State      State           `json:"state"`
	WorkerName string          `json:"worker_name,omitempty"`
	TaskID     string          `json:"task_id,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}
