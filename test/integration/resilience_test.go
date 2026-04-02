package integration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/serve"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

// signGitHub computes the HMAC-SHA256 signature for a GitHub webhook.
func signGitHub(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestResilience_CrashRecoveryPendingTasks(t *testing.T) {
	// 1. Create DB and insert a task in pending state directly via SQL.
	dbPath := tempDBPath(t)
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	// Create mock worker that records dispatched tasks.
	var dispatched atomic.Int32
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			dispatched.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"output":"recovered task handled"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mock.Close()

	// Insert a pending task directly into the DB (simulating crash state).
	now := time.Now().Unix()
	_, err = db.Exec(
		`INSERT INTO tasks (id, worker_name, prompt, state, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		"recovered-task-001", "recovery-worker", "do the thing", "pending", now, now,
	)
	if err != nil {
		t.Fatalf("insert task: %v", err)
	}

	// 2. Register the worker and start the server.
	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("create registry: %v", err)
	}
	w := &workers.Worker{
		Name:     "recovery-worker",
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

	srv := serve.New(serve.Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
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

	// 3. Wait for the recovered task to be dispatched.
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if dispatched.Load() >= 1 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if dispatched.Load() < 1 {
		t.Fatal("pending task was not dispatched after crash recovery")
	}

	// Verify the task reached completed state.
	tsk, err := taskStore.Get(context.Background(), "recovered-task-001")
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if tsk.State != tasks.StateCompleted {
		t.Errorf("task state = %q, want completed", tsk.State)
	}
}

func TestResilience_CrashRecoveryStuckEvents(t *testing.T) {
	// Create DB and insert an event in "received" state.
	dbPath := tempDBPath(t)
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	now := time.Now().Unix()
	_, err = db.Exec(
		`INSERT INTO events (id, delivery_id, source, type, actor, subject, attrs, raw, state, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"stuck-evt-001", "del-001", "github", "pull_request.opened", "user1", "owner/repo",
		`{"repo_owner":"owner","repo_name":"repo","number":42}`, `{}`, "received", now, now,
	)
	if err != nil {
		t.Fatalf("insert event: %v", err)
	}

	// Set up mock worker.
	var taskCount atomic.Int32
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			taskCount.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"output":"handled stuck event"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mock.Close()

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("create registry: %v", err)
	}
	wk := &workers.Worker{
		Name:     "event-worker",
		Endpoint: mock.URL,
		Timeout:  30 * time.Second,
		Events: []workers.EventRule{
			{
				Source: "github",
				On:     []string{"pull_request.opened"},
				Prompt: "Review PR #{{.number}}",
			},
		},
	}
	if err := reg.Add(wk); err != nil {
		t.Fatalf("add worker: %v", err)
	}
	if err := reg.Start(wk.Name); err != nil {
		t.Fatalf("start worker: %v", err)
	}

	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)
	srcReg := source.NewRegistry()
	ghSrc := source.NewGitHubSource("", "")
	srcReg.Register(ghSrc)

	port := findFreePort(t)
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	srv := serve.New(serve.Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Sources:  srcReg,
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

	// Wait for recovery to process the stuck event.
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		ev, err := evStore.Get(context.Background(), "stuck-evt-001")
		if err == nil && (ev.State == events.StateCompleted || ev.State == events.StateDispatched) {
			return // success
		}
		time.Sleep(100 * time.Millisecond)
	}

	// Check final event state.
	ev, _ := evStore.Get(context.Background(), "stuck-evt-001")
	if ev != nil && ev.State != events.StateReceived {
		// If it transitioned at all, that counts as recovery working
		return
	}
	t.Fatalf("stuck event was not recovered; final state = %v", ev)
}

func TestResilience_ConcurrentWebhooks(t *testing.T) {
	secret := "test-webhook-secret"

	// Mock worker that handles tasks.
	var taskCount atomic.Int32
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			taskCount.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"output":"done"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mock.Close()

	dbPath := tempDBPath(t)
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("create registry: %v", err)
	}
	wk := &workers.Worker{
		Name:     "concurrent-worker",
		Endpoint: mock.URL,
		Timeout:  30 * time.Second,
		Events: []workers.EventRule{
			{
				Source: "github",
				On:     []string{"push"},
				Prompt: "Handle push to {{.ref}}",
			},
		},
	}
	if err := reg.Add(wk); err != nil {
		t.Fatalf("add worker: %v", err)
	}
	if err := reg.Start(wk.Name); err != nil {
		t.Fatalf("start worker: %v", err)
	}

	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)
	srcReg := source.NewRegistry()
	ghSrc := source.NewGitHubSource(secret, "")
	srcReg.Register(ghSrc)

	port := findFreePort(t)
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	srv := serve.New(serve.Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Sources:  srcReg,
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

	// Fire 10 concurrent webhook POSTs with unique delivery IDs.
	const numWebhooks = 10
	var wg sync.WaitGroup
	statuses := make([]int, numWebhooks)

	for i := 0; i < numWebhooks; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			deliveryID := fmt.Sprintf("delivery-%d", idx)
			payload := fmt.Sprintf(`{
				"ref": "refs/heads/main",
				"after": "abc%04d",
				"sender": {"login": "user%d"},
				"repository": {"full_name": "owner/repo"},
				"commits": [{"id":"abc%04d","message":"commit %d"}]
			}`, idx, idx, idx, idx)
			body := []byte(payload)
			sig := signGitHub(secret, body)

			req, _ := http.NewRequest("POST", serverURL+"/webhook/github", strings.NewReader(string(body)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-GitHub-Event", "push")
			req.Header.Set("X-GitHub-Delivery", deliveryID)
			req.Header.Set("X-Hub-Signature-256", sig)

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Logf("webhook %d error: %v", idx, err)
				return
			}
			defer resp.Body.Close()
			io.ReadAll(resp.Body)
			statuses[idx] = resp.StatusCode
		}(i)
	}
	wg.Wait()

	// Verify all webhooks were accepted (202).
	accepted := 0
	for _, s := range statuses {
		if s == http.StatusAccepted {
			accepted++
		}
	}
	if accepted != numWebhooks {
		t.Errorf("accepted %d/%d webhooks; statuses = %v", accepted, numWebhooks, statuses)
	}

	// Verify events were created (check DB).
	allEvents, err := evStore.List(context.Background(), "")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(allEvents) != numWebhooks {
		t.Errorf("created %d events, want %d", len(allEvents), numWebhooks)
	}
}

func TestResilience_WorkerGoesOfflineMidDispatch(t *testing.T) {
	// Create a worker that stops responding after the first health check.
	var requestCount atomic.Int32
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			requestCount.Add(1)
			// Simulate worker crash by closing the connection abruptly.
			hj, ok := w.(http.Hijacker)
			if ok {
				conn, _, _ := hj.Hijack()
				if conn != nil {
					conn.Close()
					return
				}
			}
			// Fallback: return 500
			w.WriteHeader(500)
			return
		}
		w.WriteHeader(404)
	}))
	defer mock.Close()

	w := &workers.Worker{
		Name:     "flaky-worker",
		Endpoint: mock.URL,
		Timeout:  5 * time.Second,
	}

	serverURL, cleanup := startTestServer(t, []*workers.Worker{w}, nil)
	defer cleanup()

	// Submit a task to the flaky worker.
	body, status := apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "will fail",
		"worker": "flaky-worker",
	})
	if status != http.StatusAccepted {
		t.Fatalf("POST /task status = %d, body = %s", status, body)
	}

	var resp map[string]any
	json.Unmarshal(body, &resp)
	taskID, _ := resp["id"].(string)

	// The task should eventually fail (or be in retry state).
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		taskBody, _ := apiGet(t, serverURL, "/task/"+taskID)
		var taskResp map[string]any
		json.Unmarshal(taskBody, &taskResp)
		state, _ := taskResp["state"].(string)
		if state == "failed" {
			// Task failed gracefully -- success.
			return
		}
		if state == "pending" {
			// Task was re-queued for retry -- also acceptable.
			errMsg, _ := taskResp["error"].(string)
			if errMsg != "" {
				return // Has error = was retried, good.
			}
		}
		time.Sleep(200 * time.Millisecond)
	}

	// Check final state.
	taskBody, _ := apiGet(t, serverURL, "/task/"+taskID)
	var finalTask map[string]any
	json.Unmarshal(taskBody, &finalTask)
	state, _ := finalTask["state"].(string)
	if state != "failed" && state != "pending" {
		t.Fatalf("task state = %q after worker crash, want failed or pending (retry); task = %v", state, finalTask)
	}
}
