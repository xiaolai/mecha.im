package workers

import (
	"database/sql"
	"fmt"
	"sort"
	"sync"
	"time"
)

// Registry manages worker state with mutex-protected in-memory map
// and SQLite persistence. Thread-safe for concurrent access.
type Registry struct {
	mu      sync.Mutex
	entries map[string]*Entry
	db      *sql.DB
}

// NewRegistry creates a registry backed by the given SQLite database.
// Loads existing workers from the workers table.
func NewRegistry(db *sql.DB) (*Registry, error) {
	r := &Registry{
		entries: make(map[string]*Entry),
		db:      db,
	}
	if err := r.load(); err != nil {
		return nil, fmt.Errorf("load registry: %w", err)
	}
	return r, nil
}

// Add registers a new worker in offline state. Fails if name already exists.
func (r *Registry) Add(w *Worker) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entries[w.Name]; exists {
		return fmt.Errorf("worker %q already exists", w.Name)
	}
	clone := r.cloneEntries()
	clone[w.Name] = &Entry{Worker: w, State: StateOffline}
	if err := r.persist(clone); err != nil {
		return err
	}
	r.entries = clone
	return nil
}

// Remove deletes a worker from the registry. Worker must be offline.
func (r *Registry) Remove(name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[name]
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	if e.State != StateOffline {
		return fmt.Errorf("worker %q must be offline to remove (current: %s)", name, e.State)
	}
	clone := r.cloneEntries()
	delete(clone, name)
	if err := r.persist(clone); err != nil {
		return err
	}
	r.entries = clone
	return nil
}

// Start transitions a worker from offline to online. Used for unmanaged workers.
func (r *Registry) Start(name string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		if e.State != StateOffline {
			return fmt.Errorf("worker %q must be offline to start (current: %s)", name, e.State)
		}
		now := time.Now()
		e.State = StateOnline
		e.StartedAt = &now
		e.Error = ""
		return nil
	})
}

// Stop transitions a worker from online or error to offline.
func (r *Registry) Stop(name string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		if e.State != StateOnline && e.State != StateError {
			return fmt.Errorf("worker %q must be online or error to stop (current: %s)", name, e.State)
		}
		e.State = StateOffline
		e.StartedAt = nil
		e.Error = ""
		return nil
	})
}

// SetError transitions a worker to error state with a redacted error message.
func (r *Registry) SetError(name, errMsg string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		e.State = StateError
		e.Error = RedactSecrets(errMsg)
		return nil
	})
}

// SetRuntime records a Docker container's ID and endpoint, transitions to online.
// Used after a successful container start + health check.
func (r *Registry) SetRuntime(name, containerID, endpoint string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		now := time.Now()
		e.State = StateOnline
		e.StartedAt = &now
		e.ContainerID = containerID
		e.RuntimeEndpoint = endpoint
		e.Error = ""
		return nil
	})
}

// StopRuntime transitions to offline and clears the endpoint, but keeps ContainerID
// so that Remove can find and delete the stopped container.
func (r *Registry) StopRuntime(name string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		e.State = StateOffline
		e.StartedAt = nil
		e.RuntimeEndpoint = ""
		e.Error = ""
		return nil
	})
}

// ClearRuntime transitions to offline and clears all runtime fields including ContainerID.
// Used after container removal.
func (r *Registry) ClearRuntime(name string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		e.State = StateOffline
		e.StartedAt = nil
		e.ContainerID = ""
		e.RuntimeEndpoint = ""
		e.Error = ""
		return nil
	})
}

// Recover transitions a worker from error back to online. Used by the
// reconcile loop when a previously-errored container passes health checks.
func (r *Registry) Recover(name string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		if e.State != StateError {
			return fmt.Errorf("worker %q must be in error to recover (current: %s)", name, e.State)
		}
		e.State = StateOnline
		e.Error = ""
		return nil
	})
}

// SetBusy transitions a worker from online to busy (task dispatched).
func (r *Registry) SetBusy(name string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		if e.State != StateOnline {
			return fmt.Errorf("worker %q must be online to mark busy (current: %s)", name, e.State)
		}
		e.State = StateBusy
		return nil
	})
}

// SetOnline transitions a worker from busy back to online (task completed).
func (r *Registry) SetOnline(name string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		if e.State != StateBusy {
			return fmt.Errorf("worker %q must be busy to mark online (current: %s)", name, e.State)
		}
		e.State = StateOnline
		return nil
	})
}

// Get returns a deep copy of the named entry. Safe for concurrent use.
func (r *Registry) Get(name string) (Entry, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[name]
	if !ok {
		return Entry{}, false
	}
	return deepCopyEntry(e), true
}

// List returns deep copies of all entries sorted by worker name.
func (r *Registry) List() []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Entry, 0, len(r.entries))
	for _, e := range r.entries {
		result = append(result, deepCopyEntry(e))
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Worker.Name < result[j].Worker.Name
	})
	return result
}
