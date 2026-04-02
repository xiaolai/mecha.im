package tasks

import "time"

// State represents a task's lifecycle state.
type State string

const (
	// StatePending means the task is queued but not yet sent to a worker.
	StatePending State = "pending"
	// StateDispatched means the task has been sent to a worker.
	StateDispatched State = "dispatched"
	// StateCompleted means the worker returned a successful result.
	StateCompleted State = "completed"
	// StateFailed means the task errored or timed out.
	StateFailed State = "failed"
)

// Task is a unit of work sent to a worker.
type Task struct {
	ID           string     `json:"id"`
	WorkerName   string     `json:"worker_name"`
	Prompt       string     `json:"prompt"`
	Context      string     `json:"context,omitempty"`
	EventID      string     `json:"event_id,omitempty"`
	DedupKey     string     `json:"dedup_key,omitempty"`
	State        State      `json:"state"`
	Result       string     `json:"result,omitempty"`
	ErrorMsg     string     `json:"error,omitempty"`
	Attempts     int        `json:"attempts"`
	MaxRetries   int        `json:"max_retries"`
	NextRetryAt  *time.Time `json:"next_retry_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	DispatchedAt *time.Time `json:"dispatched_at,omitempty"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
}
