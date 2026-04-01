package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// --- 1. Name() on OllamaAdapter and OpenAIAdapter ---

func TestOllamaAdapterName(t *testing.T) {
	a := NewOllamaAdapter("http://localhost:11434", "gemma2:9b")
	if got := a.Name(); got != "ollama" {
		t.Errorf("Name() = %q, want %q", got, "ollama")
	}
}

func TestOpenAIAdapterName(t *testing.T) {
	a := NewOpenAIAdapter("http://localhost:8080", "gpt-4", "key")
	if got := a.Name(); got != "openai" {
		t.Errorf("Name() = %q, want %q", got, "openai")
	}
}

// --- 2. writeAdapterError ---

func TestWriteAdapterError(t *testing.T) {
	tests := []struct {
		name   string
		status int
		msg    string
	}{
		{"bad request", http.StatusBadRequest, "invalid json"},
		{"internal error", http.StatusInternalServerError, "something broke"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeAdapterError(w, tt.status, tt.msg)

			if w.Code != tt.status {
				t.Errorf("status = %d, want %d", w.Code, tt.status)
			}
			if ct := w.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}

			var body map[string]string
			if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if body["error"] != tt.msg {
				t.Errorf("error = %q, want %q", body["error"], tt.msg)
			}
		})
	}
}

// --- 3. handleHealth busy path ---

func TestRunnerHealthBusy(t *testing.T) {
	r, err := NewRunner(&mockAdapter{output: "hello"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Start()
	defer r.Stop(context.Background())

	time.Sleep(50 * time.Millisecond)

	// Set busy flag
	r.busy.Store(true)

	resp, err := http.Get(r.Endpoint() + "/health")
	if err != nil {
		t.Fatalf("health request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusServiceUnavailable)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "busy" {
		t.Errorf("body = %q, want %q", string(body), "busy")
	}

	// Reset and verify it recovers
	r.busy.Store(false)
	resp2, err := http.Get(r.Endpoint() + "/health")
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != http.StatusOK {
		t.Errorf("status after recovery = %d, want 200", resp2.StatusCode)
	}
}

// --- 4. handleTask error paths ---

type errorAdapter struct {
	sendErr error
}

func (e *errorAdapter) Name() string                                       { return "error-mock" }
func (e *errorAdapter) Health(_ context.Context) error                     { return nil }
func (e *errorAdapter) SendTask(_ context.Context, _ string) ([]byte, error) {
	return nil, e.sendErr
}

func TestRunnerTaskInvalidJSON(t *testing.T) {
	r, err := NewRunner(&mockAdapter{output: "ok"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Start()
	defer r.Stop(context.Background())
	time.Sleep(50 * time.Millisecond)

	resp, err := http.Post(r.Endpoint()+"/task", "application/json",
		strings.NewReader("not valid json"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestRunnerTaskSendError(t *testing.T) {
	r, err := NewRunner(&errorAdapter{sendErr: fmt.Errorf("upstream down")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Start()
	defer r.Stop(context.Background())
	time.Sleep(50 * time.Millisecond)

	resp, err := http.Post(r.Endpoint()+"/task", "application/json",
		strings.NewReader(`{"prompt":"test"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusInternalServerError)
	}

	var body map[string]string
	json.NewDecoder(resp.Body).Decode(&body)
	if body["error"] != "task failed" {
		t.Errorf("error = %q, want %q", body["error"], "task failed")
	}
}

func TestRunnerTaskBusy429(t *testing.T) {
	r, err := NewRunner(&mockAdapter{output: "ok"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Start()
	defer r.Stop(context.Background())
	time.Sleep(50 * time.Millisecond)

	// Set busy before calling task
	r.busy.Store(true)

	resp, err := http.Post(r.Endpoint()+"/task", "application/json",
		strings.NewReader(`{"prompt":"test"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusTooManyRequests)
	}
}

// --- 5. Start — basic lifecycle ---

func TestRunnerStartStop(t *testing.T) {
	r, err := NewRunner(&mockAdapter{output: "ok"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := r.Endpoint()
	if endpoint == "" {
		t.Fatal("expected non-empty endpoint")
	}
	if !strings.HasPrefix(endpoint, "http://127.0.0.1:") {
		t.Errorf("endpoint = %q, want http://127.0.0.1:* prefix", endpoint)
	}

	r.Start()
	time.Sleep(50 * time.Millisecond)

	// Verify it's serving
	resp, err := http.Get(endpoint + "/health")
	if err != nil {
		t.Fatalf("health: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("health status = %d", resp.StatusCode)
	}

	// Stop
	if err := r.Stop(context.Background()); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	// After stop, requests should fail
	_, err = http.Get(endpoint + "/health")
	if err == nil {
		t.Error("expected error after stop")
	}
}

// --- Additional: Ollama health non-200 ---

func TestOllamaAdapterHealthNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer srv.Close()

	a := NewOllamaAdapter(srv.URL, "model")
	err := a.Health(context.Background())
	if err == nil {
		t.Error("expected error for non-200 health check")
	}
}

// --- Additional: Ollama SendTask non-200 ---

func TestOllamaAdapterSendTaskNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		w.Write([]byte("bad request"))
	}))
	defer srv.Close()

	a := NewOllamaAdapter(srv.URL, "model")
	_, err := a.SendTask(context.Background(), "test")
	if err == nil {
		t.Error("expected error for non-200")
	}
}

// --- Additional: OpenAI health non-200 ---

func TestOpenAIAdapterHealthNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
	}))
	defer srv.Close()

	a := NewOpenAIAdapter(srv.URL, "model", "key")
	err := a.Health(context.Background())
	if err == nil {
		t.Error("expected error for non-200 health check")
	}
}

// --- Additional: OpenAI SendTask non-200 ---

func TestOpenAIAdapterSendTaskNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte("internal error"))
	}))
	defer srv.Close()

	a := NewOpenAIAdapter(srv.URL, "model", "key")
	_, err := a.SendTask(context.Background(), "test")
	if err == nil {
		t.Error("expected error for non-200")
	}
}

// --- Additional: OpenAI no API key ---

func TestOpenAIAdapterNoAPIKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("expected no Authorization header when apiKey is empty")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/models" {
			w.Write([]byte(`{"data":[]}`))
		} else {
			json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{"message": map[string]string{"content": "response"}},
				},
				"usage": map[string]int{"prompt_tokens": 1, "completion_tokens": 2},
			})
		}
	}))
	defer srv.Close()

	a := NewOpenAIAdapter(srv.URL, "model", "")
	if err := a.Health(context.Background()); err != nil {
		t.Errorf("Health: %v", err)
	}
	result, err := a.SendTask(context.Background(), "hello")
	if err != nil {
		t.Fatalf("SendTask: %v", err)
	}
	var res map[string]any
	json.Unmarshal(result, &res)
	if res["output"] != "response" {
		t.Errorf("output = %v", res["output"])
	}
}

// --- Additional: OpenAI empty choices ---

func TestOpenAIAdapterEmptyChoices(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{},
			"usage":   map[string]int{"prompt_tokens": 0, "completion_tokens": 0},
		})
	}))
	defer srv.Close()

	a := NewOpenAIAdapter(srv.URL, "model", "key")
	result, err := a.SendTask(context.Background(), "hello")
	if err != nil {
		t.Fatalf("SendTask: %v", err)
	}
	var res map[string]any
	json.Unmarshal(result, &res)
	if res["output"] != "" {
		t.Errorf("output = %v, want empty string", res["output"])
	}
}
