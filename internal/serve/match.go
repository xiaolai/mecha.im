package serve

import (
	"bytes"
	"encoding/json"
	"fmt"
	"text/template"

	"mecha.im/internal/events"
	"mecha.im/internal/workers"
)

func matchesRule(rule workers.EventRule, ev *events.Event) bool {
	if rule.Source != ev.Source {
		return false
	}
	matched := false
	for _, on := range rule.On {
		if on == ev.Type {
			matched = true
			break
		}
	}
	if !matched {
		return false
	}
	for k, v := range rule.Filter {
		actual := fmt.Sprint(ev.Attrs[k])
		if actual != v {
			return false
		}
	}
	return true
}

func renderPrompt(rule workers.EventRule, ev *events.Event) (string, error) {
	tmpl, err := template.New("prompt").Option("missingkey=error").Parse(rule.Prompt)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}
	// Build template data from Attrs + universal fields
	data := make(map[string]any)
	data["actor"] = ev.Actor
	data["subject"] = ev.Subject
	data["source"] = ev.Source
	data["type"] = ev.Type
	for k, v := range ev.Attrs {
		data[k] = v
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}
	return buf.String(), nil
}

func buildTaskContext(ev *events.Event) (string, error) {
	ctx := map[string]any{
		"source":  ev.Source,
		"actor":   ev.Actor,
		"subject": ev.Subject,
	}
	// Copy well-known attrs for task context
	for _, key := range []string{"repo_owner", "repo_name", "number", "ref",
		"diff", "file_list", "head_sha", "sender"} {
		if v, ok := ev.Attrs[key]; ok {
			ctx[key] = v
		}
	}
	b, err := json.Marshal(ctx)
	if err != nil {
		return "{}", fmt.Errorf("marshal task context: %w", err)
	}
	return string(b), nil
}
