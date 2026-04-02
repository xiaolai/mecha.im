package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/serve"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

func TestRateLimit_ThrottlesAndRequeues(t *testing.T) {
	// Worker that takes 50ms to respond. This gives time for the second
	// task to arrive at dispatch while the first is still in-flight,
	// but the task will complete fast enough not to timeout.
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" && r.Method == http.MethodPost {
			time.Sleep(50 * time.Millisecond)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"output":"rate limited task done"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mock.Close()

	// Build server with a rate limiter that has a very low rate.
	// 0.5 req/s with burst 1: first request allowed, then must wait 2s
	// for the next token.
	dbPath := tempDBPath(t)
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("create registry: %v", err)
	}
	w := &workers.Worker{
		Name:     "rl-worker",
		Endpoint: mock.URL,
		Timeout:  30 * time.Second,
	}
	if err := reg.Add(w); err != nil {
		t.Fatalf("add worker: %v", err)
	}
	if err := reg.Start(w.Name); err != nil {
		t.Fatalf("start worker: %v", err)
	}

	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)

	port := findFreePort(t)
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	// Very restrictive rate: 0.5 req/s, burst 1. After the initial burst
	// token is consumed, tasks must wait ~2s for a new token.
	limiter := serve.NewRateLimiter(0.5, 1)

	srv := serve.New(serve.Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Limiter:  limiter,
		Addr:     addr,
	})

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()

	serverURL := fmt.Sprintf("http://%s", addr)
	waitForServerHealth(t, serverURL, 5*time.Second)
	defer func() {
		cancel()
		<-errCh
		db.Close()
	}()

	// Submit the first task. It consumes the burst token and dispatches.
	body1, status1 := apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "rate limit test 0",
		"worker": "rl-worker",
	})
	if status1 != http.StatusAccepted {
		t.Fatalf("POST /task[0] status = %d, body = %s", status1, body1)
	}
	var resp1 map[string]any
	json.Unmarshal(body1, &resp1)
	taskID0, _ := resp1["id"].(string)

	// Wait for the first task to complete so the worker goes back to online.
	pollTaskState(t, serverURL, taskID0, 10*time.Second)

	// Now submit the second task immediately. The rate limiter's token
	// was consumed < 2s ago, so this dispatch should be rate-limited
	// and re-queued.
	body2, status2 := apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "rate limit test 1",
		"worker": "rl-worker",
	})
	if status2 != http.StatusAccepted {
		t.Fatalf("POST /task[1] status = %d, body = %s", status2, body2)
	}
	var resp2 map[string]any
	json.Unmarshal(body2, &resp2)
	taskID1, _ := resp2["id"].(string)

	// Wait for the second task to complete too. The rate limiter will
	// re-queue it, and eventually the token refills.
	result := pollTaskState(t, serverURL, taskID1, 20*time.Second)
	state, _ := result["state"].(string)
	if state != "completed" {
		t.Errorf("task[1] state = %q, want completed; result = %v", state, result)
	}

	// Verify rate limiting metric is > 0.
	metricsBody, status := apiGet(t, serverURL, "/metrics")
	if status != 200 {
		t.Fatalf("GET /metrics status = %d", status)
	}
	metricsStr := string(metricsBody)
	if !strings.Contains(metricsStr, "mecha_tasks_rate_limited") {
		t.Error("metrics missing mecha_tasks_rate_limited")
	}

	// Parse the metric value to confirm it's non-zero.
	found := false
	for _, line := range strings.Split(metricsStr, "\n") {
		if strings.HasPrefix(line, "mecha_tasks_rate_limited ") {
			found = true
			parts := strings.Fields(line)
			if len(parts) >= 2 && parts[1] == "0" {
				t.Error("expected mecha_tasks_rate_limited > 0, got 0")
			}
		}
	}
	if !found {
		t.Error("mecha_tasks_rate_limited metric line not found")
	}
}
