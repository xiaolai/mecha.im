package source

import (
	"context"
	"net/http"

	"mecha.im/internal/event"
)

// Source parses incoming webhooks into normalized events.
type Source interface {
	Name() string
	Parse(headers http.Header, body []byte) (*event.Event, error)
}

// Hydrator enriches an event with additional data (e.g., fetching diffs).
type Hydrator interface {
	Hydrate(ctx context.Context, ev *event.Event) error
}

// Registry holds registered event sources by name.
type Registry struct {
	sources map[string]Source
}

// NewRegistry creates an empty source registry.
func NewRegistry() *Registry {
	return &Registry{sources: make(map[string]Source)}
}

// Register adds a source to the registry.
func (r *Registry) Register(s Source) {
	r.sources[s.Name()] = s
}

// Get returns a source by name.
func (r *Registry) Get(name string) (Source, bool) {
	s, ok := r.sources[name]
	return s, ok
}

// Len returns the number of registered sources.
func (r *Registry) Len() int {
	if r == nil {
		return 0
	}
	return len(r.sources)
}
