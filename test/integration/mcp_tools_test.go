package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/serve"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

// findFreePort finds an available TCP port on localhost.
func findFreePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	return port
}

// mockWorker returns an httptest.Server that responds to /health and /task.
func mockWorker(result string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(result))
			return
		}
		w.WriteHeader(404)
	}))
}

// startTestServer creates a fully wired mecha server for integration tests.
// It opens a temp DB, registers the provided workers, and starts serving.
func startTestServer(t *testing.T, workerList []*workers.Worker, sources *source.Registry) (serverURL string, cleanup func()) {
	t.Helper()

	dbPath := tempDBPath(t)
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("create registry: %v", err)
	}
	for _, w := range workerList {
		if err := reg.Add(w); err != nil {
			t.Fatalf("add worker %s: %v", w.Name, err)
		}
		if w.Endpoint != "" {
			if err := reg.Start(w.Name); err != nil {
				t.Fatalf("start worker %s: %v", w.Name, err)
			}
		}
	}

	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)

	port := findFreePort(t)
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	cfg := serve.Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Sources:  sources,
		Addr:     addr,
	}

	srv := serve.New(cfg)
	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()

	serverURL = fmt.Sprintf("http://%s", addr)
	waitForServerHealth(t, serverURL, 5*time.Second)

	cleanup = func() {
		cancel()
		<-errCh
		db.Close()
	}
	return serverURL, cleanup
}

// tempDBPath returns a path for a temp SQLite DB.
func tempDBPath(t *testing.T) string {
	t.Helper()
	return t.TempDir() + "/mecha-test.db"
}

// waitForServerHealth polls the server until /health returns 200 or timeout.
func waitForServerHealth(t *testing.T, base string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	for time.Now().Before(deadline) {
		resp, err := client.Get(base + "/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("server at %s did not become healthy within %v", base, timeout)
}

// apiGet does GET to base+path and returns body.
func apiGet(t *testing.T, base, path string) ([]byte, int) {
	t.Helper()
	resp, err := http.Get(base + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return body, resp.StatusCode
}

// apiPost does POST JSON to base+path.
func apiPost(t *testing.T, base, path string, payload any) ([]byte, int) {
	t.Helper()
	data, _ := json.Marshal(payload)
	resp, err := http.Post(base+path, "application/json", strings.NewReader(string(data)))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return body, resp.StatusCode
}

// waitForTaskState polls GET /task/{id} until the task reaches the target
// state or timeout, then returns. Fatal if timeout is reached.
func waitForTaskState(t *testing.T, base, taskID, want string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		body, status := apiGet(t, base, "/task/"+taskID)
		if status == 200 {
			var result map[string]any
			json.Unmarshal(body, &result)
			if state, _ := result["state"].(string); state == want {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("task %s did not reach state %q within %v", taskID, want, timeout)
}

// pollTaskState polls GET /task/{id} until the task reaches a terminal state
// or timeout.
func pollTaskState(t *testing.T, base, taskID string, timeout time.Duration) map[string]any {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		body, status := apiGet(t, base, "/task/"+taskID)
		if status == 200 {
			var result map[string]any
			json.Unmarshal(body, &result)
			state, _ := result["state"].(string)
			if state == "completed" || state == "failed" {
				return result
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("task %s did not reach terminal state within %v", taskID, timeout)
	return nil
}

func TestMCP_TaskSubmitAndStatus(t *testing.T) {
	workerResult := `{"output":"review done","metadata":{"model":"test"}}`
	mock := mockWorker(workerResult)
	defer mock.Close()

	w := &workers.Worker{
		Name:     "reviewer",
		Endpoint: mock.URL,
		Timeout:  30 * time.Second,
	}

	serverURL, cleanup := startTestServer(t, []*workers.Worker{w}, nil)
	defer cleanup()

	// Submit task via HTTP API (what MCP mecha-task tool does)
	body, status := apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "review this code",
		"worker": "reviewer",
	})
	if status != http.StatusAccepted {
		t.Fatalf("POST /task status = %d, body = %s", status, body)
	}

	var taskResp map[string]any
	json.Unmarshal(body, &taskResp)
	taskID, ok := taskResp["id"].(string)
	if !ok || taskID == "" {
		t.Fatalf("no task ID in response: %s", body)
	}

	// Poll for completion (what MCP mecha-task-status does)
	result := pollTaskState(t, serverURL, taskID, 10*time.Second)
	state, _ := result["state"].(string)
	if state != "completed" {
		t.Fatalf("task state = %q, want completed; result = %v", state, result)
	}
	taskResult, _ := result["result"].(string)
	if !strings.Contains(taskResult, "review done") {
		t.Errorf("task result = %q, want to contain 'review done'", taskResult)
	}
}

func TestMCP_WorkerList(t *testing.T) {
	mock := mockWorker(`{"output":"ok"}`)
	defer mock.Close()

	workerList := []*workers.Worker{
		{Name: "alpha", Endpoint: mock.URL, Timeout: 5 * time.Minute},
		{Name: "beta", Endpoint: mock.URL, Timeout: 5 * time.Minute},
	}

	serverURL, cleanup := startTestServer(t, workerList, nil)
	defer cleanup()

	body, status := apiGet(t, serverURL, "/workers")
	if status != 200 {
		t.Fatalf("GET /workers status = %d", status)
	}

	var entries []map[string]any
	json.Unmarshal(body, &entries)
	if len(entries) != 2 {
		t.Fatalf("got %d workers, want 2", len(entries))
	}

	names := map[string]bool{}
	for _, e := range entries {
		w, _ := e["worker"].(map[string]any)
		// Worker struct uses yaml tags only, so JSON uses Go field names (capital)
		name, _ := w["Name"].(string)
		names[name] = true
		st, _ := e["state"].(string)
		if st != "online" {
			t.Errorf("worker %s state = %q, want online", name, st)
		}
	}
	if !names["alpha"] || !names["beta"] {
		t.Errorf("missing expected workers: got %v", names)
	}
}

func TestMCP_TaskList(t *testing.T) {
	// Use a fast worker that completes immediately so we can list tasks.
	mock := mockWorker(`{"output":"listed"}`)
	defer mock.Close()

	w := &workers.Worker{
		Name:     "list-worker",
		Endpoint: mock.URL,
		Timeout:  30 * time.Second,
	}

	serverURL, cleanup := startTestServer(t, []*workers.Worker{w}, nil)
	defer cleanup()

	// Create two tasks.
	apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "task one",
		"worker": "list-worker",
	})
	apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "task two",
		"worker": "list-worker",
	})

	// Wait briefly for dispatch to process them.
	time.Sleep(500 * time.Millisecond)

	// List all tasks.
	body, status := apiGet(t, serverURL, "/tasks")
	if status != 200 {
		t.Fatalf("GET /tasks status = %d", status)
	}
	var taskList []map[string]any
	json.Unmarshal(body, &taskList)
	if len(taskList) < 2 {
		t.Fatalf("expected at least 2 tasks, got %d", len(taskList))
	}
}

func TestMCP_Metrics(t *testing.T) {
	mock := mockWorker(`{"output":"done"}`)
	defer mock.Close()

	w := &workers.Worker{
		Name:     "metric-worker",
		Endpoint: mock.URL,
		Timeout:  30 * time.Second,
	}

	serverURL, cleanup := startTestServer(t, []*workers.Worker{w}, nil)
	defer cleanup()

	// Submit and wait for a task to complete so metrics are populated
	body, _ := apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "hello",
		"worker": "metric-worker",
	})
	var resp map[string]any
	json.Unmarshal(body, &resp)
	taskID, _ := resp["id"].(string)
	if taskID != "" {
		pollTaskState(t, serverURL, taskID, 10*time.Second)
	}

	metricsBody, status := apiGet(t, serverURL, "/metrics")
	if status != 200 {
		t.Fatalf("GET /metrics status = %d", status)
	}
	metricsStr := string(metricsBody)

	// Verify Prometheus text format with expected metric names
	expectedMetrics := []string{
		"mecha_tasks_created",
		"mecha_tasks_completed",
		"mecha_tasks_failed",
	}
	for _, m := range expectedMetrics {
		if !strings.Contains(metricsStr, m) {
			t.Errorf("metrics missing %q; full metrics:\n%s", m, metricsStr)
		}
	}
	if !strings.Contains(metricsStr, "# TYPE") {
		t.Errorf("metrics not in Prometheus format")
	}
}
