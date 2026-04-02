package policy

import (
	"context"
	"testing"

	"mecha.im/internal/event"
)

// --- 1. DenyAll.Apply() ---

func TestDenyAllApply(t *testing.T) {
	d := &DenyAll{}
	res := Result{
		Output:  "some output",
		Comment: &CommentAction{Target: "pr:42", Body: "review comment"},
		Labels:  &LabelAction{Add: []string{"security"}, Remove: []string{"needs-review"}},
		Status:  &StatusAction{State: "failure", Description: "check failed"},
		Commit:  &CommitAction{Message: "fix bug", Diff: "--- a\n+++ b"},
		Metadata: map[string]any{
			"model":       "claude-sonnet-4-6",
			"duration_ms": 45000,
		},
	}

	filtered, decision, err := d.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}

	// Output is preserved
	if filtered.Output != "some output" {
		t.Errorf("Output = %q, want preserved", filtered.Output)
	}

	// All action fields must be stripped
	if filtered.Comment != nil {
		t.Error("Comment should be nil after DenyAll")
	}
	if filtered.Labels != nil {
		t.Error("Labels should be nil after DenyAll")
	}
	if filtered.Status != nil {
		t.Error("Status should be nil after DenyAll")
	}
	if filtered.Commit != nil {
		t.Error("Commit should be nil after DenyAll")
	}

	// All 5 categories denied (comment, labels, status, commit, metadata)
	if filtered.Metadata != nil {
		t.Error("Metadata should be nil after DenyAll")
	}
	if len(decision.Denied) != 5 {
		t.Errorf("Denied count = %d, want 5; denied = %v", len(decision.Denied), decision.Denied)
	}
	if len(decision.Allowed) != 0 {
		t.Errorf("Allowed = %v, want empty", decision.Allowed)
	}

	// Verify each denial message
	wantDenied := map[string]bool{
		"comment: denied (invalid policy config)": true,
		"labels: denied (invalid policy config)":  true,
		"status: denied (invalid policy config)":  true,
		"commit: denied (invalid policy config)":   true,
		"metadata: denied (invalid policy config)": true,
	}
	for _, msg := range decision.Denied {
		if !wantDenied[msg] {
			t.Errorf("unexpected denied message: %q", msg)
		}
		delete(wantDenied, msg)
	}
	if len(wantDenied) > 0 {
		t.Errorf("missing denied messages: %v", wantDenied)
	}
}

func TestDenyAllPartialResult(t *testing.T) {
	d := &DenyAll{}
	// Only comment and status set
	res := Result{
		Output:  "partial",
		Comment: &CommentAction{Body: "hello"},
		Status:  &StatusAction{State: "success"},
	}

	filtered, decision, err := d.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}

	if filtered.Comment != nil || filtered.Status != nil {
		t.Error("all actions should be denied")
	}
	if len(decision.Denied) != 2 {
		t.Errorf("Denied count = %d, want 2", len(decision.Denied))
	}
}

func TestDenyAllEmptyResult(t *testing.T) {
	d := &DenyAll{}
	res := Result{Output: "just output"}

	filtered, decision, err := d.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}

	if filtered.Output != "just output" {
		t.Errorf("Output = %q", filtered.Output)
	}
	if len(decision.Denied) != 0 {
		t.Errorf("Denied = %v, want empty for no actions", decision.Denied)
	}
}
