package workers

import (
	"fmt"
	"text/template"
)

// EventRule defines when a worker should handle an event.
type EventRule struct {
	Source string            `yaml:"source" json:"source"`
	On     []string          `yaml:"on" json:"on"`
	Filter map[string]string `yaml:"filter,omitempty" json:"filter,omitempty"`
	Prompt string            `yaml:"prompt" json:"prompt"`
	Auto   *bool             `yaml:"auto,omitempty" json:"auto,omitempty"`
}

// IsAuto returns whether this rule dispatches automatically (default: true).
func (r EventRule) IsAuto() bool {
	if r.Auto == nil {
		return true
	}
	return *r.Auto
}

func (r EventRule) validate(idx int) error {
	if r.Source == "" {
		return fmt.Errorf("events[%d].source is required", idx)
	}
	if len(r.On) == 0 {
		return fmt.Errorf("events[%d].on is required", idx)
	}
	if r.Prompt == "" {
		return fmt.Errorf("events[%d].prompt is required", idx)
	}
	if _, err := template.New("").Parse(r.Prompt); err != nil {
		return fmt.Errorf("events[%d].prompt: invalid template: %w", idx, err)
	}
	return nil
}
