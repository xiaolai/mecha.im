package source

import (
	"context"
	"net/http"

	"mecha.im/internal/event"
	"mecha.im/internal/policy"
)

// Source parses incoming webhooks into normalized events.
type Source interface {
	Name() string
	Parse(headers http.Header, body []byte) (*event.Event, error)
}

// Trigger generates events actively (cron, polling, subscriptions).
// Start runs until ctx is cancelled. Events are emitted via the emit callback.
type Trigger interface {
	Name() string
	Start(ctx context.Context, emit func(*event.Event)) error
}

// Hydrator enriches an event with additional data (e.g., fetching diffs).
type Hydrator interface {
	Hydrate(ctx context.Context, ev *event.Event) error
}

// Verifier handles webhook verification challenges (e.g., Meta, Slack).
type Verifier interface {
	Verify(r *http.Request) ([]byte, error)
}

// Responder writes task results back to an external platform.
// Name returns the responder identifier (e.g., "github", "slack").
type Responder interface {
	Name() string
	Respond(ctx context.Context, ev *event.Event, res policy.Result) error
}

// Registry holds registered event sources, triggers, and responders by name.
type Registry struct {
	sources    map[string]Source
	triggers   map[string]Trigger
	responders map[string]Responder
}

// NewRegistry creates an empty source registry.
func NewRegistry() *Registry {
	return &Registry{
		sources:    make(map[string]Source),
		triggers:   make(map[string]Trigger),
		responders: make(map[string]Responder),
	}
}

// Register adds a source to the registry.
func (r *Registry) Register(s Source) {
	r.sources[s.Name()] = s
}

// RegisterTrigger adds an active trigger to the registry.
func (r *Registry) RegisterTrigger(t Trigger) {
	r.triggers[t.Name()] = t
}

// RegisterResponder adds a responder to the registry.
func (r *Registry) RegisterResponder(resp Responder) {
	r.responders[resp.Name()] = resp
}

// Get returns a source by name.
func (r *Registry) Get(name string) (Source, bool) {
	s, ok := r.sources[name]
	return s, ok
}

// GetTrigger returns a trigger by name.
func (r *Registry) GetTrigger(name string) (Trigger, bool) {
	t, ok := r.triggers[name]
	return t, ok
}

// GetResponder returns a responder by name.
func (r *Registry) GetResponder(name string) (Responder, bool) {
	resp, ok := r.responders[name]
	return resp, ok
}

// Triggers returns a copy of all registered triggers.
func (r *Registry) Triggers() map[string]Trigger {
	cp := make(map[string]Trigger, len(r.triggers))
	for k, v := range r.triggers {
		cp[k] = v
	}
	return cp
}

// Len returns the number of registered sources.
func (r *Registry) Len() int {
	if r == nil {
		return 0
	}
	return len(r.sources)
}
