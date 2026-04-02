package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/adapter"
	"mecha.im/internal/events"
	"mecha.im/internal/serve"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

func TestAdapter_OllamaEndToEnd(t *testing.T) {
	// Mock Ollama server.
	mockOllama := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" && r.Method == http.MethodGet {
			w.WriteHeader(200)
			w.Write([]byte("Ollama is running"))
			return
		}
		if r.URL.Path == "/api/chat" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"model": "test-model",
				"message": map[string]string{
					"role":    "assistant",
					"content": "adapter response from ollama",
				},
				"done":              true,
				"prompt_eval_count": 10,
				"eval_count":        20,
			})
			return
		}
		w.WriteHeader(404)
	}))
	defer mockOllama.Close()

	// Create the adapter and runner.
	ollamaAdapter := adapter.NewOllamaAdapter(mockOllama.URL, "test-model")
	runner, err := adapter.NewRunner(ollamaAdapter, slog.Default())
	if err != nil {
		t.Fatalf("create adapter runner: %v", err)
	}
	runner.Start()
	defer runner.Stop(context.Background())

	adapterEndpoint := runner.Endpoint()

	// Wait for adapter to be ready.
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.Get(adapterEndpoint + "/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Build server with the adapter worker registered.
	dbPath := tempDBPath(t)
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("create registry: %v", err)
	}

	// Register the worker with the adapter's endpoint.
	w := &workers.Worker{
		Name: "ollama-test",
		Adapter: &workers.AdapterConfig{
			Type:     "ollama",
			Upstream: mockOllama.URL,
			Model:    "test-model",
		},
		Timeout: 30 * time.Second,
	}
	if err := reg.Add(w); err != nil {
		t.Fatalf("add worker: %v", err)
	}
	// Set the runtime endpoint (simulating what CLI's adapterStart does).
	if err := reg.SetRuntime(w.Name, "", adapterEndpoint); err != nil {
		t.Fatalf("set runtime: %v", err)
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

	// Submit task via POST /task.
	body, status := apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "what is the meaning of life",
		"worker": "ollama-test",
	})
	if status != http.StatusAccepted {
		t.Fatalf("POST /task status = %d, body = %s", status, body)
	}

	var resp map[string]any
	json.Unmarshal(body, &resp)
	taskID, _ := resp["id"].(string)
	if taskID == "" {
		t.Fatalf("no task ID in response: %s", body)
	}

	// Poll for completion.
	result := pollTaskState(t, serverURL, taskID, 15*time.Second)
	state, _ := result["state"].(string)
	if state != "completed" {
		t.Fatalf("task state = %q, want completed; result = %v", state, result)
	}

	// Verify the result contains the adapter's response.
	taskResult, _ := result["result"].(string)
	if !strings.Contains(taskResult, "adapter response from ollama") {
		t.Errorf("task result = %q, want to contain 'adapter response from ollama'", taskResult)
	}

	// Verify metadata includes the model name.
	var parsed map[string]any
	if err := json.Unmarshal([]byte(taskResult), &parsed); err == nil {
		meta, _ := parsed["metadata"].(map[string]any)
		model, _ := meta["model"].(string)
		if model != "test-model" {
			t.Errorf("metadata.model = %q, want 'test-model'", model)
		}
	}
}

func TestAdapter_OllamaHealthFailure(t *testing.T) {
	// Mock Ollama that is down (returns 503).
	mockDown := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
	}))
	defer mockDown.Close()

	ollamaAdapter := adapter.NewOllamaAdapter(mockDown.URL, "test-model")
	runner, err := adapter.NewRunner(ollamaAdapter, slog.Default())
	if err != nil {
		t.Fatalf("create runner: %v", err)
	}
	runner.Start()
	defer runner.Stop(context.Background())

	// Health check on the adapter runner should return 503.
	client := &http.Client{Timeout: 2 * time.Second}
	time.Sleep(100 * time.Millisecond) // let server start

	resp, err := client.Get(runner.Endpoint() + "/health")
	if err != nil {
		t.Fatalf("health GET: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("health status = %d, want 503", resp.StatusCode)
	}
}
