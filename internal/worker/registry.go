package worker

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type Registry struct {
	mu      sync.Mutex
	entries map[string]*Entry
	path    string
}

func NewRegistry(path string) (*Registry, error) {
	r := &Registry{
		entries: make(map[string]*Entry),
		path:    path,
	}
	if err := r.load(); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("load registry: %w", err)
	}
	return r, nil
}

func DefaultRegistryPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	return filepath.Join(home, ".mecha", "registry.json"), nil
}

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

func (r *Registry) SetError(name, errMsg string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		e.State = StateError
		e.Error = RedactSecrets(errMsg)
		return nil
	})
}

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

func (r *Registry) StopRuntime(name string) error {
	return r.mutateEntry(name, func(e *Entry) error {
		e.State = StateOffline
		e.StartedAt = nil
		e.RuntimeEndpoint = ""
		e.Error = ""
		return nil
	})
}

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

func (r *Registry) Get(name string) (Entry, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[name]
	if !ok {
		return Entry{}, false
	}
	return *e, true
}

func (r *Registry) List() []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Entry, 0, len(r.entries))
	for _, e := range r.entries {
		result = append(result, *e)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Worker.Name < result[j].Worker.Name
	})
	return result
}

func (r *Registry) mutateEntry(name string, fn func(e *Entry) error) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.entries[name]; !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	clone := r.cloneEntries()
	if err := fn(clone[name]); err != nil {
		return err
	}
	if err := r.persist(clone); err != nil {
		return err
	}
	r.entries = clone
	return nil
}

func (r *Registry) cloneEntries() map[string]*Entry {
	clone := make(map[string]*Entry, len(r.entries))
	for k, e := range r.entries {
		ec := *e
		if ec.Worker != nil {
			wc := *ec.Worker
			ec.Worker = &wc
		}
		clone[k] = &ec
	}
	return clone
}
