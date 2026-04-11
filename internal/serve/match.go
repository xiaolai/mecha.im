package serve

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
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
	// Build template data: attrs first, then universal fields.
	// Universal fields set AFTER attrs so user-controlled attrs
	// cannot override them (e.g., a crafted "source" attr).
	//
	// Sanitize all string values from ev.Attrs before insertion.
	// ev.Attrs comes directly from the webhook payload (PR title, body,
	// commit messages, etc.) and is user-controlled. Without sanitization,
	// a PR body containing "{{range .}}...{{end}}" would be executed by
	// text/template, leaking internal event data to the LLM prompt or
	// causing template execution errors. We replace "{{" and "}}" with
	// their harmless doubled-brace equivalents so the text is passed
	// through literally. Only string values are affected; non-string
	// values (numbers, booleans) cannot contain template directives.
	data := make(map[string]any)
	for k, v := range ev.Attrs {
		data[k] = sanitizeTemplateValue(v)
	}
	data["actor"] = ev.Actor
	data["subject"] = ev.Subject
	data["source"] = ev.Source
	data["type"] = ev.Type
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}
	return buf.String(), nil
}

// sanitizeTemplateValue strips Go template directives from user-controlled
// string values before they are placed into a text/template data map.
// "{{" and "}}" are replaced with "{ {" and "} }" so they are rendered
// as literal text rather than executed as template actions.
// Non-string values are returned unchanged.
func sanitizeTemplateValue(v any) any {
	s, ok := v.(string)
	if !ok {
		return v
	}
	s = strings.ReplaceAll(s, "{{", "{ {")
	s = strings.ReplaceAll(s, "}}", "} }")
	return s
}

// buildTaskContext serializes well-known event fields into a JSON string for
// the task context field. json.Marshal on this map cannot fail: ev.Attrs
// values come from JSON unmarshal and are always primitive or collection types.
func buildTaskContext(ev *events.Event) string {
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
	b, _ := json.Marshal(ctx) // cannot fail on webhook-deserialized map
	return string(b)
}
