package source

import (
	"net/http"
	"testing"
)

func TestGenericSourceName(t *testing.T) {
	src := NewGenericSource("custom", "")
	if src.Name() != "custom" {
		t.Errorf("Name() = %q, want custom", src.Name())
	}
}

func TestGenericSourceParse(t *testing.T) {
	src := NewGenericSource("jenkins", "X-Event-Type")
	body := []byte(`{"build_id": 42, "status": "success", "branch": "main"}`)

	h := http.Header{}
	h.Set("X-Event-Type", "build.completed")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Source != "jenkins" {
		t.Errorf("Source = %q, want jenkins", ev.Source)
	}
	if ev.Type != "build.completed" {
		t.Errorf("Type = %q, want build.completed", ev.Type)
	}
	if ev.Payload["status"] != "success" {
		t.Errorf("status = %v", ev.Payload["status"])
	}
	if ev.Payload["branch"] != "main" {
		t.Errorf("branch = %v", ev.Payload["branch"])
	}
}

func TestGenericSourceMissingHeader(t *testing.T) {
	src := NewGenericSource("hook", "")
	h := http.Header{}
	_, err := src.Parse(h, []byte(`{}`))
	if err == nil {
		t.Error("expected error for missing event type header")
	}
}

func TestGenericSourceCustomHeader(t *testing.T) {
	src := NewGenericSource("slack", "X-Slack-Event")
	body := []byte(`{"type": "message", "text": "hello"}`)

	h := http.Header{}
	h.Set("X-Slack-Event", "message.created")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "message.created" {
		t.Errorf("Type = %q", ev.Type)
	}
}

func TestGenericSourceDefaultHeader(t *testing.T) {
	src := NewGenericSource("test", "")
	if src.typeHeader != "X-Event-Type" {
		t.Errorf("default header = %q, want X-Event-Type", src.typeHeader)
	}
}
