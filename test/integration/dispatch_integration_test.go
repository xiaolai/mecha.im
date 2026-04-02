package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"mecha.im/internal/workers"
)

func TestDispatch_MultiWorkerRoundRobin(t *testing.T) {
	// Create 3 workers each with an atomic counter to track task dispatch.
	type workerEntry struct {
		name    string
		counter *atomic.Int32
		server  *httptest.Server
	}

	entries := make([]workerEntry, 3)
	names := []string{"alpha", "beta", "gamma"}

	for i, name := range names {
		counter := &atomic.Int32{}
		// Capture name per iteration for the closure.
		workerName := name
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/health" {
				w.WriteHeader(200)
				return
			}
			if r.URL.Path == "/task" && r.Method == http.MethodPost {
				counter.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(fmt.Sprintf(`{"output":"handled by %s"}`, workerName)))
				return
			}
			w.WriteHeader(404)
		}))
		entries[i] = workerEntry{name: name, counter: counter, server: srv}
	}
	defer func() {
		for _, e := range entries {
			e.server.Close()
		}
	}()

	// Register all 3 workers.
	workerList := make([]*workers.Worker, len(entries))
	for i, e := range entries {
		workerList[i] = &workers.Worker{
			Name:     e.name,
			Endpoint: e.server.URL,
			Timeout:  30 * time.Second,
		}
	}

	serverURL, cleanup := startTestServer(t, workerList, nil)
	defer cleanup()

	// Submit 6 tasks WITHOUT specifying a worker name.
	// Space them out with small waits so each worker has time to
	// transition back from busy→online before the next round-robin hit.
	const numTasks = 6
	taskIDs := make([]string, numTasks)
	for i := 0; i < numTasks; i++ {
		body, status := apiPost(t, serverURL, "/task", map[string]string{
			"prompt": fmt.Sprintf("round robin task %d", i),
		})
		if status != http.StatusAccepted {
			t.Fatalf("POST /task[%d] status = %d, body = %s", i, status, body)
		}
		var resp map[string]any
		json.Unmarshal(body, &resp)
		taskIDs[i], _ = resp["id"].(string)
		// Small delay between submissions to allow busy→online transitions.
		time.Sleep(100 * time.Millisecond)
	}

	// Wait for all 6 tasks to reach a terminal state.
	completed := 0
	for i, id := range taskIDs {
		result := pollTaskState(t, serverURL, id, 30*time.Second)
		state, _ := result["state"].(string)
		if state == "completed" {
			completed++
		} else {
			t.Logf("task[%d] state = %q (not completed)", i, state)
		}
	}

	// All 6 should complete.
	if completed != numTasks {
		t.Errorf("completed = %d, want %d", completed, numTasks)
	}

	// Verify distribution: each worker should have received at least 1 task.
	total := int32(0)
	for _, e := range entries {
		count := e.counter.Load()
		total += count
		if count == 0 {
			t.Errorf("worker %q received 0 tasks, expected >= 1", e.name)
		}
	}

	if total != int32(numTasks) {
		t.Errorf("total dispatched = %d, want %d", total, numTasks)
	}

	// Log distribution for visibility.
	for _, e := range entries {
		t.Logf("worker %q received %d tasks", e.name, e.counter.Load())
	}
}
