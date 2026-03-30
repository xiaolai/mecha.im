package serve

import (
	"bytes"
	"encoding/json"
	"fmt"
	"text/template"

	"mecha.im/internal/event"
	"mecha.im/internal/worker"
)

func matchesRule(rule worker.EventRule, ev *event.Event) bool {
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
		actual := fmt.Sprint(ev.Payload[k])
		if actual != v {
			return false
		}
	}
	return true
}

func renderPrompt(rule worker.EventRule, ev *event.Event) (string, error) {
	tmpl, err := template.New("prompt").Parse(rule.Prompt)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}
	data := make(map[string]any)
	data["repo_owner"] = ev.RepoOwner
	data["repo_name"] = ev.RepoName
	data["ref"] = ev.Ref
	data["number"] = ev.Number
	data["sender"] = ev.Sender
	for k, v := range ev.Payload {
		data[k] = v
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}
	return buf.String(), nil
}

func buildTaskContext(ev *event.Event) string {
	ctx := map[string]any{
		"repo":   ev.RepoOwner + "/" + ev.RepoName,
		"number": ev.Number,
		"ref":    ev.Ref,
		"sender": ev.Sender,
	}
	if diff, ok := ev.Payload["diff"]; ok {
		ctx["diff"] = diff
	}
	if files, ok := ev.Payload["file_list"]; ok {
		ctx["files"] = files
	}
	if sha, ok := ev.Payload["head_sha"]; ok {
		ctx["head_sha"] = sha
	}
	b, _ := json.Marshal(ctx)
	return string(b)
}
