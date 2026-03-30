package worker

import (
	"fmt"
)

// Reload re-reads all workers from SQLite into the in-memory cache.
// Loads into a temporary map and swaps on success (safe on failure).
func (r *Registry) Reload() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	tmp := &Registry{db: r.db, entries: make(map[string]*Entry)}
	if err := tmp.load(); err != nil {
		return fmt.Errorf("reload registry: %w", err)
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
		return fmt.Errorf("persist registry: %w", err)
	}
	r.entries = clone
	return nil
}

func deepCopyEntry(e *Entry) Entry {
	ec := *e
	if ec.Worker != nil {
		wc := *ec.Worker
		wc.Policy = copyMapAny(wc.Policy)
		wc.Events = copyEvents(wc.Events)
		if wc.Docker != nil {
			dc := *wc.Docker
			dc.Env = copyMapStr(dc.Env)
			dc.Labels = copyMapStr(dc.Labels)
			wc.Docker = &dc
		}
		ec.Worker = &wc
	}
	return ec
}

func (r *Registry) cloneEntries() map[string]*Entry {
	clone := make(map[string]*Entry, len(r.entries))
	for k, e := range r.entries {
		ec := deepCopyEntry(e)
		clone[k] = &ec
	}
	return clone
}

func copyMapAny(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	c := make(map[string]any, len(m))
	for k, v := range m {
		switch val := v.(type) {
		case map[string]any:
			c[k] = copyMapAny(val)
		case []any:
			s := make([]any, len(val))
			copy(s, val)
			c[k] = s
		default:
			c[k] = v
		}
	}
	return c
}

func copyMapStr(m map[string]string) map[string]string {
	if m == nil {
		return nil
	}
	c := make(map[string]string, len(m))
	for k, v := range m {
		c[k] = v
	}
	return c
}

func copyEvents(events []EventRule) []EventRule {
	if events == nil {
		return nil
	}
	c := make([]EventRule, len(events))
	for i, e := range events {
		c[i] = e
		c[i].Filter = copyMapStr(e.Filter)
	}
	return c
}
