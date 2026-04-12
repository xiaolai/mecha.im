package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func withMockAPI(t *testing.T, handler http.HandlerFunc) func() {
	t.Helper()
	srv := httptest.NewServer(handler)
	old := mechaAPI
	mechaAPI = srv.URL
	return func() {
		mechaAPI = old
		srv.Close()
	}
}

func callTool(name string, args map[string]any) mcpResponse {
	return handleToolCall(1, name, args)
}

func TestMechaTask(t *testing.T) {
	cleanup := withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/task" || r.Method != "POST" {
			http.Error(w, "not found", 404)
			return
		}
		var req map[string]string
		json.NewDecoder(r.Body).Decode(&req)
		if req["prompt"] == "" {
			http.Error(w, "missing prompt", 400)
			return
		}
		w.WriteHeader(202)
		json.NewEncoder(w).Encode(map[string]string{"id": "task-123", "state": "pending"})
	})
	defer cleanup()

	resp := callTool("mecha-task", map[string]any{"prompt": "review this PR"})
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}
	content := extractText(resp)
	if !strings.Contains(content, "task-123") {
		t.Errorf("response should contain task ID, got: %s", content)
	}
}

func TestMechaTaskMissingPrompt(t *testing.T) {
	resp := callTool("mecha-task", map[string]any{})
	content := extractText(resp)
	if !strings.Contains(content, "prompt is required") {
		t.Errorf("expected prompt error, got: %s", content)
	}
}

func TestMechaTaskStatus(t *testing.T) {
	cleanup := withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/task/") {
			http.Error(w, "not found", 404)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/task/")
		json.NewEncoder(w).Encode(map[string]any{
			"id": id, "state": "completed", "result": `{"output":"done"}`,
		})
	})
	defer cleanup()

	resp := callTool("mecha-task-status", map[string]any{"id": "task-456"})
	content := extractText(resp)
	if !strings.Contains(content, "completed") {
		t.Errorf("expected completed state, got: %s", content)
	}
}

func TestMechaTaskStatusMissingID(t *testing.T) {
	resp := callTool("mecha-task-status", map[string]any{})
	content := extractText(resp)
	if !strings.Contains(content, "id is required") {
		t.Errorf("expected id error, got: %s", content)
	}
}

func TestMechaWorkers(t *testing.T) {
	cleanup := withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/workers" {
			http.Error(w, "not found", 404)
			return
		}
		json.NewEncoder(w).Encode([]map[string]any{
			{"name": "w1", "state": "online"},
			{"name": "w2", "state": "offline"},
		})
	})
	defer cleanup()

	resp := callTool("mecha-workers", nil)
	content := extractText(resp)
	if !strings.Contains(content, "w1") || !strings.Contains(content, "online") {
		t.Errorf("expected worker list, got: %s", content)
	}
}

func TestMechaTasks(t *testing.T) {
	cleanup := withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tasks" {
			http.Error(w, "not found", 404)
			return
		}
		state := r.URL.Query().Get("state")
		json.NewEncoder(w).Encode([]map[string]any{
			{"id": "t1", "state": state},
		})
	})
	defer cleanup()

	resp := callTool("mecha-tasks", map[string]any{"state": "completed"})
	content := extractText(resp)
	if !strings.Contains(content, "completed") {
		t.Errorf("expected filtered tasks, got: %s", content)
	}
}

func TestMechaEvents(t *testing.T) {
	cleanup := withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/events" {
			http.Error(w, "not found", 404)
			return
		}
		json.NewEncoder(w).Encode([]map[string]any{{"id": "e1", "source": "github"}})
	})
	defer cleanup()

	resp := callTool("mecha-events", map[string]any{})
	content := extractText(resp)
	if !strings.Contains(content, "github") {
		t.Errorf("expected events, got: %s", content)
	}
}

func TestMechaFireEvent(t *testing.T) {
	cleanup := withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/webhook/") {
			http.Error(w, "not found", 404)
			return
		}
		w.WriteHeader(202)
		w.Write([]byte(`{"status":"accepted"}`))
	})
	defer cleanup()

	resp := callTool("mecha-fire-event", map[string]any{
		"source": "generic",
		"body":   `{"text":"hello"}`,
	})
	content := extractText(resp)
	if !strings.Contains(content, "accepted") {
		t.Errorf("expected accepted, got: %s", content)
	}
}

func TestMechaFireEventMissing(t *testing.T) {
	resp := callTool("mecha-fire-event", map[string]any{})
	content := extractText(resp)
	if !strings.Contains(content, "required") {
		t.Errorf("expected required error, got: %s", content)
	}
}

func TestMechaMetrics(t *testing.T) {
	cleanup := withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/metrics" {
			http.Error(w, "not found", 404)
			return
		}
		w.Write([]byte("# TYPE mecha_tasks_completed gauge\nmecha_tasks_completed 42\n"))
	})
	defer cleanup()

	resp := callTool("mecha-metrics", nil)
	content := extractText(resp)
	if !strings.Contains(content, "tasks_completed") || !strings.Contains(content, "42") {
		t.Errorf("expected metrics, got: %s", content)
	}
}

func TestMechaTaskWaitCompleted(t *testing.T) {
	calls := 0
	cleanup := withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/task" {
			w.WriteHeader(202)
			json.NewEncoder(w).Encode(map[string]string{"id": "wait-1"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/task/") {
			calls++
			state := "dispatched"
			if calls >= 2 {
				state = "completed"
			}
			json.NewEncoder(w).Encode(map[string]any{
				"id": "wait-1", "state": state, "result": `{"output":"done"}`,
			})
			return
		}
	})
	defer cleanup()

	resp := callTool("mecha-task-wait", map[string]any{"prompt": "test", "timeout": float64(10)})
	content := extractText(resp)
	if !strings.Contains(content, "completed") {
		t.Errorf("expected completed, got: %s", content)
	}
}

func TestMechaAPIUnreachable(t *testing.T) {
	old := mechaAPI
	mechaAPI = "http://127.0.0.1:1"
	defer func() { mechaAPI = old }()

	resp := callTool("mecha-workers", nil)
	content := extractText(resp)
	if !strings.Contains(content, "unreachable") {
		t.Errorf("expected unreachable error, got: %s", content)
	}
}

func TestMechaAPIError(t *testing.T) {
	cleanup := withMockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
	})
	defer cleanup()

	resp := callTool("mecha-task", map[string]any{"prompt": "test"})
	content := extractText(resp)
	if !strings.Contains(content, "403") {
		t.Errorf("expected 403 error, got: %s", content)
	}
}

func TestFormatMetrics(t *testing.T) {
	raw := `# TYPE mecha_tasks_created gauge
mecha_tasks_created 10
# TYPE mecha_tasks_failed gauge
mecha_tasks_failed 2
`
	out := formatMetrics(raw)
	if !strings.Contains(out, "tasks_created") || !strings.Contains(out, "10") {
		t.Errorf("unexpected format: %s", out)
	}
	if !strings.Contains(out, "tasks_failed") || !strings.Contains(out, "2") {
		t.Errorf("unexpected format: %s", out)
	}
}

func extractText(resp mcpResponse) string {
	result, ok := resp.Result.(map[string]any)
	if !ok {
		return ""
	}
	content, ok := result["content"].([]map[string]any)
	if !ok || len(content) == 0 {
		return ""
	}
	text, _ := content[0]["text"].(string)
	return text
}
