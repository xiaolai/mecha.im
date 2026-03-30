package worker

import "fmt"

// Reload re-reads all workers from SQLite into the in-memory cache.
// Loads into a temporary map and swaps on success (safe on failure).
func (r *Registry) Reload() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	tmp := &Registry{db: r.db, entries: make(map[string]*Entry)}
	if err := tmp.load(); err != nil {
		return err
	}
	r.entries = tmp.entries
	return nil
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

func deepCopyEntry(e *Entry) Entry {
	ec := *e
	if ec.Worker != nil {
		wc := *ec.Worker
		ec.Worker = &wc
	}
	return ec
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
