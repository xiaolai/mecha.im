package worker

import (
	"fmt"
	"time"
)

func (w *Worker) validate() error {
	if w.Name == "" {
		return fmt.Errorf("name is required")
	}
	if !validName.MatchString(w.Name) {
		return fmt.Errorf("name %q is invalid (must match [a-zA-Z0-9][a-zA-Z0-9_.-]*)", w.Name)
	}
	if w.Endpoint == "" && w.Docker == nil && w.Adapter == nil && w.SSH == nil {
		return fmt.Errorf("endpoint, docker, adapter, or ssh section is required")
	}
	sections := 0
	if w.Docker != nil {
		sections++
	}
	if w.Adapter != nil {
		sections++
	}
	if w.SSH != nil {
		sections++
	}
	if sections > 1 {
		return fmt.Errorf("only one of docker, adapter, or ssh sections allowed")
	}
	if w.Timeout < 0 {
		return fmt.Errorf("timeout must be non-negative")
	}
	if w.Docker != nil {
		if err := w.Docker.Validate(); err != nil {
			return err
		}
	}
	if w.Adapter != nil {
		if err := w.Adapter.Validate(); err != nil {
			return err
		}
	}
	if w.SSH != nil {
		if err := w.SSH.Validate(); err != nil {
			return err
		}
	}
	for i, rule := range w.Events {
		if err := rule.validate(i); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) applyDefaults() {
	if w.Timeout == 0 {
		w.Timeout = 10 * time.Minute
	}
	if w.Docker != nil {
		if w.Docker.Lifecycle == "" {
			w.Docker.Lifecycle = "persistent"
		}
	}
	if w.SSH != nil {
		if w.SSH.Port == 0 {
			w.SSH.Port = 22
		}
	}
}
