package worker

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
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
	Worker          *Worker    `json:"worker"`
	State           State      `json:"state"`
	Error           string     `json:"error,omitempty"`
	StartedAt       *time.Time `json:"started_at,omitempty"`
	ContainerID     string     `json:"container_id,omitempty"`
	RuntimeEndpoint string     `json:"runtime_endpoint,omitempty"`
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
	clone := r.cloneEntries()
	ce := clone[name]
	ce.State = StateOnline
	ce.StartedAt = &now
	ce.Error = ""
	if err := r.persist(clone); err != nil {
		return err
	}
	r.entries = clone
	return nil
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
	clone := r.cloneEntries()
	ce := clone[name]
	ce.State = StateOffline
	ce.StartedAt = nil
	ce.Error = ""
	if err := r.persist(clone); err != nil {
		return err
	}
	r.entries = clone
	return nil
}

func (r *Registry) SetError(name, errMsg string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.entries[name]; !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	redacted := RedactSecrets(errMsg)
	clone := r.cloneEntries()
	ce := clone[name]
	ce.State = StateError
	ce.Error = redacted
	if err := r.persist(clone); err != nil {
		return err
	}
	r.entries = clone
	return nil
}

func (r *Registry) SetRuntime(name, containerID, endpoint string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.entries[name]; !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	now := time.Now()
	clone := r.cloneEntries()
	ce := clone[name]
	ce.State = StateOnline
	ce.StartedAt = &now
	ce.ContainerID = containerID
	ce.RuntimeEndpoint = endpoint
	ce.Error = ""
	if err := r.persist(clone); err != nil {
		return err
	}
	r.entries = clone
	return nil
}

func (r *Registry) StopRuntime(name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.entries[name]; !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	clone := r.cloneEntries()
	ce := clone[name]
	ce.State = StateOffline
	ce.StartedAt = nil
	ce.RuntimeEndpoint = ""
	ce.Error = ""
	// Keep ContainerID so remove can find the stopped container.
	if err := r.persist(clone); err != nil {
		return err
	}
	r.entries = clone
	return nil
}

func (r *Registry) ClearRuntime(name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.entries[name]; !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	clone := r.cloneEntries()
	ce := clone[name]
	ce.State = StateOffline
	ce.StartedAt = nil
	ce.ContainerID = ""
	ce.RuntimeEndpoint = ""
	ce.Error = ""
	if err := r.persist(clone); err != nil {
		return err
	}
	r.entries = clone
	return nil
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

func (r *Registry) load() error {
	data, err := os.ReadFile(r.path)
	if err != nil {
		return err // preserve os.IsNotExist for caller
	}
	if err := json.Unmarshal(data, &r.entries); err != nil {
		return fmt.Errorf("unmarshal registry: %w", err)
	}
	return nil
}

func (r *Registry) persist(entries map[string]*Entry) error {
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal registry: %w", err)
	}
	dir := filepath.Dir(r.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create registry dir: %w", err)
	}
	tmp := r.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
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
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("close registry: %w", err)
	}
	if err := os.Rename(tmp, r.path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("rename registry: %w", err)
	}
	return syncDir(dir)
}

func syncDir(path string) error {
	d, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("sync dir: %w", err)
	}
	defer d.Close()
	return d.Sync()
}
