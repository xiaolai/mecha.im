package worker

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type State string

const (
	StateOffline State = "offline"
	StateOnline  State = "online"
	StateBusy    State = "busy"
	StateError   State = "error"
)

type Entry struct {
	Worker    *Worker    `json:"worker"`
	State     State      `json:"state"`
	Error     string     `json:"error,omitempty"`
	StartedAt *time.Time `json:"started_at,omitempty"`
}

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

func DefaultRegistryPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".mecha", "registry.json")
}

func (r *Registry) Add(w *Worker) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entries[w.Name]; exists {
		return fmt.Errorf("worker %q already exists", w.Name)
	}
	r.entries[w.Name] = &Entry{Worker: w, State: StateOffline}
	return r.persist()
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
	delete(r.entries, name)
	return r.persist()
}

func (r *Registry) Start(name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[name]
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	if e.State != StateOffline {
		return fmt.Errorf("worker %q must be offline to start (current: %s)", name, e.State)
	}
	now := time.Now()
	e.State = StateOnline
	e.StartedAt = &now
	e.Error = ""
	return r.persist()
}

func (r *Registry) Stop(name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[name]
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	if e.State != StateOnline && e.State != StateError {
		return fmt.Errorf("worker %q must be online or error to stop (current: %s)", name, e.State)
	}
	e.State = StateOffline
	e.StartedAt = nil
	e.Error = ""
	return r.persist()
}

func (r *Registry) SetError(name, errMsg string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[name]
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	e.State = StateError
	e.Error = errMsg
	return r.persist()
}

func (r *Registry) Get(name string) (*Entry, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[name]
	return e, ok
}

func (r *Registry) List() []*Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]*Entry, 0, len(r.entries))
	for _, e := range r.entries {
		result = append(result, e)
	}
	return result
}

func (r *Registry) load() error {
	data, err := os.ReadFile(r.path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &r.entries)
}

func (r *Registry) persist() error {
	data, err := json.MarshalIndent(r.entries, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal registry: %w", err)
	}
	dir := filepath.Dir(r.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create registry dir: %w", err)
	}
	tmp := r.path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return fmt.Errorf("write registry: %w", err)
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return fmt.Errorf("sync registry: %w", err)
	}
	f.Close()
	if err := os.Rename(tmp, r.path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("rename registry: %w", err)
	}
	return nil
}
