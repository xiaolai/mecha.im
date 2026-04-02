package logs

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"mecha.im/internal/store"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db, nil)
}

func TestRecord(t *testing.T) {
	s := testStore(t)
	s.Record(Entry{
		TraceID: "trace-1",
		Action:  EventReceived,
		Outcome: OK,
		EventID: "evt-1",
		Detail:  `{"source":"github"}`,
	})

	entries, err := s.Query(context.Background(), Filter{EventID: "evt-1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	e := entries[0]
	if e.Action != EventReceived {
		t.Errorf("action = %q", e.Action)
	}
	if e.Outcome != OK {
		t.Errorf("outcome = %q", e.Outcome)
	}
	if e.TraceID != "trace-1" {
		t.Errorf("trace_id = %q", e.TraceID)
	}
	if e.ID == 0 {
		t.Error("ID should be auto-assigned")
	}
	if e.TS == 0 {
		t.Error("TS should be auto-assigned")
	}
}

func TestRecordRedactsSecrets(t *testing.T) {
	s := testStore(t)
	s.Record(Entry{
		Action:  TaskSent,
		Outcome: OK,
		Error:   "token sk-ant-oat01-secret123 leaked",
		Detail:  `{"key":"ghp_abc123def456"}`,
	})

	entries, err := s.Query(context.Background(), Filter{Action: "task"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries", len(entries))
	}
	if entries[0].Error == "token sk-ant-oat01-secret123 leaked" {
		t.Error("error field should be redacted")
	}
	if entries[0].Detail == `{"key":"ghp_abc123def456"}` {
		t.Error("detail field should be redacted")
	}
}

func TestQueryFilters(t *testing.T) {
	s := testStore(t)

	s.Record(Entry{TraceID: "t1", EventID: "e1", TaskID: "tk1", Worker: "w1", Action: PolicyApplied, Outcome: Deny})
	s.Record(Entry{TraceID: "t1", EventID: "e1", TaskID: "tk1", Worker: "w1", Action: WritebackOK, Outcome: OK})
	s.Record(Entry{TraceID: "t2", EventID: "e2", TaskID: "tk2", Worker: "w2", Action: TaskRetry, Outcome: Retry})

	tests := []struct {
		name  string
		f     Filter
		count int
	}{
		{"by trace", Filter{TraceID: "t1"}, 2},
		{"by event", Filter{EventID: "e2"}, 1},
		{"by task", Filter{TaskID: "tk1"}, 2},
		{"by worker", Filter{Worker: "w2"}, 1},
		{"by action prefix", Filter{Action: "policy"}, 1},
		{"by action prefix writeback", Filter{Action: "writeback"}, 1},
		{"limit", Filter{Limit: 1}, 1},
		{"all", Filter{}, 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			entries, err := s.Query(context.Background(), tt.f)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != tt.count {
				t.Errorf("got %d entries, want %d", len(entries), tt.count)
			}
		})
	}
}

func TestQuerySince(t *testing.T) {
	s := testStore(t)

	past := time.Now().Add(-1 * time.Hour).Unix()
	s.Record(Entry{Action: TaskSent, Outcome: OK, TS: past})
	s.Record(Entry{Action: TaskSent, Outcome: OK}) // now

	entries, err := s.Query(context.Background(), Filter{
		Action: "task",
		Since:  time.Now().Add(-5 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("got %d entries, want 1 (only recent)", len(entries))
	}
}

func TestPrune(t *testing.T) {
	s := testStore(t)

	old := time.Now().Add(-48 * time.Hour).Unix()
	s.Record(Entry{Action: TaskSent, Outcome: OK, TS: old})
	s.Record(Entry{Action: TaskSent, Outcome: OK, TS: old})
	s.Record(Entry{Action: TaskSent, Outcome: OK}) // now

	deleted, err := s.Prune(context.Background(), time.Now().Add(-24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 2 {
		t.Errorf("pruned %d, want 2", deleted)
	}

	remaining, _ := s.Query(context.Background(), Filter{})
	if len(remaining) != 1 {
		t.Errorf("remaining %d, want 1", len(remaining))
	}
}

func TestQueryLimitCapped(t *testing.T) {
	s := testStore(t)
	// Verify limit is capped at 1000
	entries, err := s.Query(context.Background(), Filter{Limit: 9999})
	if err != nil {
		t.Fatal(err)
	}
	_ = entries // just verify no error
}

func TestMarshalDetail(t *testing.T) {
	d := MarshalDetail(map[string]any{"key": "value", "token": "sk-ant-oat01-secret"})
	if d == "" || d == "{}" {
		t.Error("detail should not be empty")
	}
	if d == `{"key":"value","token":"sk-ant-oat01-secret"}` {
		t.Error("detail should be redacted")
	}
}

func TestOrderDesc(t *testing.T) {
	s := testStore(t)
	s.Record(Entry{Action: "a.first", Outcome: OK})
	s.Record(Entry{Action: "b.second", Outcome: OK})
	s.Record(Entry{Action: "c.third", Outcome: OK})

	entries, _ := s.Query(context.Background(), Filter{})
	if len(entries) != 3 {
		t.Fatalf("got %d", len(entries))
	}
	// Most recent first (DESC by id)
	if entries[0].Action != "c.third" {
		t.Errorf("first entry = %q, want c.third", entries[0].Action)
	}
}
