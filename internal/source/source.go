package source

import (
	"context"
	"net/http"
	"sync"

	"mecha.im/internal/events"
	"mecha.im/internal/policies"
)

// Source parses incoming webhooks into normalized events.
type Source interface {
	Name() string
	Parse(headers http.Header, body []byte) (*events.Event, error)
}

// Trigger generates events actively (cron, polling, subscriptions).
// Start runs until ctx is cancelled. Events are emitted via the emit callback.
type Trigger interface {
	Name() string
	Start(ctx context.Context, emit func(*events.Event)) error
}

// Hydrator enriches an event with additional data (e.g., fetching diffs).
type Hydrator interface {
	Hydrate(ctx context.Context, ev *events.Event) error
}

// Authenticated is a marker interface for sources that validate webhooks
// themselves (e.g., HMAC signature, token comparison). Sources without
// this marker require server-level API key auth on their webhook paths.
type Authenticated interface {
	Authenticated()
}

// Verifier handles webhook verification challenges (e.g., Meta, Slack).
type Verifier interface {
	Verify(r *http.Request) ([]byte, error)
}

// Responder writes task results back to an external platform.
// Name returns the responder identifier (e.g., "github", "slack").
type Responder interface {
	Name() string
	Respond(ctx context.Context, ev *events.Event, res policies.Result) error
}

// Registry holds registered event sources, triggers, and responders by name.
// Thread-safe: safe for concurrent reads and SIGHUP-triggered hot-reload writes.
type Registry struct {
	mu         sync.RWMutex
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

// Register adds or replaces a source in the registry.
// Safe to call concurrently with Get (e.g., on SIGHUP hot-reload).
func (r *Registry) Register(s Source) {
	r.mu.Lock()
	r.sources[s.Name()] = s
	r.mu.Unlock()
}

// RegisterTrigger adds an active trigger to the registry.
func (r *Registry) RegisterTrigger(t Trigger) {
	r.mu.Lock()
	r.triggers[t.Name()] = t
	r.mu.Unlock()
}

// RegisterResponder adds a responder to the registry.
func (r *Registry) RegisterResponder(resp Responder) {
	r.mu.Lock()
	r.responders[resp.Name()] = resp
	r.mu.Unlock()
}

// Get returns a source by name.
func (r *Registry) Get(name string) (Source, bool) {
	r.mu.RLock()
	s, ok := r.sources[name]
	r.mu.RUnlock()
	return s, ok
}

// GetTrigger returns a trigger by name.
func (r *Registry) GetTrigger(name string) (Trigger, bool) {
	r.mu.RLock()
	t, ok := r.triggers[name]
	r.mu.RUnlock()
	return t, ok
}

// GetResponder returns a responder by name.
func (r *Registry) GetResponder(name string) (Responder, bool) {
	r.mu.RLock()
	resp, ok := r.responders[name]
	r.mu.RUnlock()
	return resp, ok
}

// Triggers returns a snapshot of all registered triggers.
func (r *Registry) Triggers() map[string]Trigger {
	r.mu.RLock()
	cp := make(map[string]Trigger, len(r.triggers))
	for k, v := range r.triggers {
		cp[k] = v
	}
	r.mu.RUnlock()
	return cp
}

// Len returns the number of registered sources.
func (r *Registry) Len() int {
	if r == nil {
		return 0
	}
	r.mu.RLock()
	n := len(r.sources)
	r.mu.RUnlock()
	return n
}
