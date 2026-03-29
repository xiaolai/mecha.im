package worker

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

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
