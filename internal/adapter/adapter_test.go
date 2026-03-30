package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// mockAdapter implements Adapter for testing.
type mockAdapter struct {
	healthErr error
	output    string
}

func (m *mockAdapter) Name() string { return "mock" }

func (m *mockAdapter) Health(ctx context.Context) error {
	return m.healthErr
}

func (m *mockAdapter) SendTask(ctx context.Context, prompt string) ([]byte, error) {
	return json.Marshal(map[string]any{
		"output": m.output + " " + prompt,
		"metadata": map[string]any{
			"model": "mock-model",
		},
	})
}

func TestRunnerHealthy(t *testing.T) {
	r, err := NewRunner(&mockAdapter{output: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	r.Start()
	defer r.Stop(context.Background())

	time.Sleep(50 * time.Millisecond) // let server start

	resp, err := http.Get(r.Endpoint() + "/health")
	if err != nil {
		t.Fatalf("health request: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("health status = %d, want 200", resp.StatusCode)
	}
}

func TestRunnerTask(t *testing.T) {
	r, err := NewRunner(&mockAdapter{output: "result:"})
	if err != nil {
		t.Fatal(err)
	}
	r.Start()
	defer r.Stop(context.Background())

	time.Sleep(50 * time.Millisecond)

	body := strings.NewReader(`{"prompt":"test prompt"}`)
	resp, err := http.Post(r.Endpoint()+"/task", "application/json", body)
	if err != nil {
		t.Fatalf("task request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("task status = %d, want 200", resp.StatusCode)
	}

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	output, _ := result["output"].(string)
	if !strings.Contains(output, "test prompt") {
		t.Errorf("output = %q, should contain prompt", output)
	}
}

func TestRunnerUnhealthyUpstream(t *testing.T) {
	r, err := NewRunner(&mockAdapter{healthErr: fmt.Errorf("unreachable")})
	if err != nil {
		t.Fatal(err)
	}
	r.Start()
	defer r.Stop(context.Background())

	time.Sleep(50 * time.Millisecond)

	resp, err := http.Get(r.Endpoint() + "/health")
	if err != nil {
		t.Fatalf("health request: %v", err)
	}
	if resp.StatusCode != 503 {
		t.Errorf("health status = %d, want 503", resp.StatusCode)
	}
}

func TestOllamaAdapterHealth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("Ollama is running"))
	}))
	defer srv.Close()

	a := NewOllamaAdapter(srv.URL, "test-model")
	if err := a.Health(context.Background()); err != nil {
		t.Errorf("Health() error: %v", err)
	}
}

func TestOllamaAdapterSendTask(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"message":           map[string]string{"content": "response text"},
			"prompt_eval_count": 10,
			"eval_count":        20,
		})
	}))
	defer srv.Close()

	a := NewOllamaAdapter(srv.URL, "gemma2:9b")
	result, err := a.SendTask(context.Background(), "hello")
	if err != nil {
		t.Fatalf("SendTask() error: %v", err)
	}

	var res map[string]any
	json.Unmarshal(result, &res)
	if res["output"] != "response text" {
		t.Errorf("output = %v, want 'response text'", res["output"])
	}
}

func TestOpenAIAdapterSendTask(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing auth header")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": "AI response"}},
			},
			"usage": map[string]int{
				"prompt_tokens":     5,
				"completion_tokens": 10,
			},
		})
	}))
	defer srv.Close()

	a := NewOpenAIAdapter(srv.URL, "gpt-4", "test-key")
	result, err := a.SendTask(context.Background(), "hello")
	if err != nil {
		t.Fatalf("SendTask() error: %v", err)
	}

	var res map[string]any
	json.Unmarshal(result, &res)
	if res["output"] != "AI response" {
		t.Errorf("output = %v, want 'AI response'", res["output"])
	}
}

func TestOpenAIAdapterHealth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[]}`))
	}))
	defer srv.Close()

	a := NewOpenAIAdapter(srv.URL, "model", "key")
	if err := a.Health(context.Background()); err != nil {
		t.Errorf("Health() error: %v", err)
	}
}
