package audit

import "time"

// Entry is a single audit trail record.
type Entry struct {
	ID      int64  `json:"id"`
	TraceID string `json:"trace_id,omitempty"`
	TS      int64  `json:"ts"`
	Action  string `json:"action"`
	Outcome string `json:"outcome"` // ok, fail, skip, retry, deny
	EventID string `json:"event_id,omitempty"`
	TaskID  string `json:"task_id,omitempty"`
	Worker  string `json:"worker,omitempty"`
	Attempt int    `json:"attempt,omitempty"`
	Error   string `json:"error,omitempty"`
	Detail  string `json:"detail,omitempty"` // sparse JSON tail, redacted
}

// Filter constrains audit queries.
type Filter struct {
	TraceID string
	EventID string
	TaskID  string
	Worker  string
	Action  string    // prefix match: "policy" matches "policy.applied"
	Since   time.Time
	Until   time.Time
	Limit   int // default 100, max 1000
}

// Logger records audit entries. Implementations must be safe for concurrent use.
type Logger interface {
	Record(e Entry)
}

// Actions used across the pipeline. Constants prevent taxonomy drift.
const (
	EventReceived  = "event.received"
	EventDuplicate = "event.duplicate"
	EventMatched   = "event.matched"
	EventSkipped   = "event.skipped"
	EventHydrated  = "event.hydrated"
	TaskCreated    = "task.created"
	TaskSent       = "task.sent"
	TaskRateLimited = "task.rate_limited"
	TaskRetry      = "task.retry"
	TaskDeadLetter = "task.dead_letter"
	PolicyApplied  = "policy.applied"
	WritebackOK    = "writeback.ok"
	WritebackFail  = "writeback.fail"
	WorkerState    = "worker.state"
)

// Outcomes.
const (
	OK    = "ok"
	Fail  = "fail"
	Skip  = "skip"
	Retry = "retry"
	Deny  = "deny"
)
