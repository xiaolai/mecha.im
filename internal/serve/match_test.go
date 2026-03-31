package serve

import (
	"testing"

	"mecha.im/internal/event"
	"mecha.im/internal/worker"
)

func TestMatchesRule(t *testing.T) {
	ev := &event.Event{
		Source: "github",
		Type:   "pull_request.opened",
		Attrs:  event.Attrs{"action": "opened", "number": 42},
	}

	tests := []struct {
		name string
		rule worker.EventRule
		want bool
	}{
		{"exact match", worker.EventRule{Source: "github", On: []string{"pull_request.opened"}}, true},
		{"wrong source", worker.EventRule{Source: "gitlab", On: []string{"pull_request.opened"}}, false},
		{"wrong type", worker.EventRule{Source: "github", On: []string{"push"}}, false},
		{"multiple on types", worker.EventRule{Source: "github", On: []string{"push", "pull_request.opened"}}, true},
		{"filter match", worker.EventRule{Source: "github", On: []string{"pull_request.opened"}, Filter: map[string]string{"action": "opened"}}, true},
		{"filter mismatch", worker.EventRule{Source: "github", On: []string{"pull_request.opened"}, Filter: map[string]string{"action": "closed"}}, false},
		{"filter missing key", worker.EventRule{Source: "github", On: []string{"pull_request.opened"}, Filter: map[string]string{"missing": "val"}}, false},
		{"empty on", worker.EventRule{Source: "github", On: []string{}}, false},
		{"numeric filter", worker.EventRule{Source: "github", On: []string{"pull_request.opened"}, Filter: map[string]string{"number": "42"}}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := matchesRule(tt.rule, ev); got != tt.want {
				t.Errorf("matchesRule() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMatchesRuleNilAttrs(t *testing.T) {
	ev := &event.Event{Source: "github", Type: "push", Attrs: nil}
	rule := worker.EventRule{Source: "github", On: []string{"push"}, Filter: map[string]string{"ref": "main"}}
	if matchesRule(rule, ev) {
		t.Error("should not match when attrs is nil and filter requires a key")
	}
}

func TestRenderPrompt(t *testing.T) {
	rule := worker.EventRule{
		Prompt: "Review PR #{{ .number }} by {{ .actor }} on {{ .subject }}",
	}
	ev := &event.Event{
		Actor:   "alice",
		Subject: "org/repo",
		Attrs:   event.Attrs{"number": 42},
	}
	got, err := renderPrompt(rule, ev)
	if err != nil {
		t.Fatal(err)
	}
	if got != "Review PR #42 by alice on org/repo" {
		t.Errorf("renderPrompt() = %q", got)
	}
}

func TestRenderPromptMissingKey(t *testing.T) {
	rule := worker.EventRule{Prompt: "{{ .nonexistent }}"}
	ev := &event.Event{Attrs: event.Attrs{}}
	_, err := renderPrompt(rule, ev)
	if err == nil {
		t.Error("expected error for missing key with missingkey=error")
	}
}

func TestRenderPromptInvalidTemplate(t *testing.T) {
	rule := worker.EventRule{Prompt: "{{ .unclosed"}
	ev := &event.Event{Attrs: event.Attrs{}}
	_, err := renderPrompt(rule, ev)
	if err == nil {
		t.Error("expected error for malformed template")
	}
}

func TestBuildTaskContext(t *testing.T) {
	ev := &event.Event{
		Source:  "github",
		Actor:   "alice",
		Subject: "org/repo",
		Attrs: event.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     42,
			"extra":      "ignored",
		},
	}
	got, err := buildTaskContext(ev)
	if err != nil {
		t.Fatal(err)
	}
	if got == "{}" {
		t.Error("expected non-empty context")
	}
}
