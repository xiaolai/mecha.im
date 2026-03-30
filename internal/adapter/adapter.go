package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

// Adapter translates a native LLM API into the mecha worker contract.
// Each adapter runs an in-process HTTP server (GET /health, POST /task).
type Adapter interface {
	// Name returns the adapter type (e.g., "ollama", "openai").
	Name() string

	// Health checks whether the upstream is reachable and ready.
	Health(ctx context.Context) error

	// SendTask sends a prompt to the upstream and returns the result JSON.
	SendTask(ctx context.Context, prompt string) ([]byte, error)
}

// Runner wraps an Adapter with an HTTP server that implements the worker contract.
type Runner struct {
	adapter  Adapter
	listener net.Listener
	server   *http.Server
	busy     sync.Mutex
	isBusy   bool
}

// NewRunner creates a runner for the given adapter.
// The runner listens on a random localhost port.
func NewRunner(a Adapter) (*Runner, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}
	r := &Runner{adapter: a, listener: ln}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", r.handleHealth)
	mux.HandleFunc("POST /task", r.handleTask)
	r.server = &http.Server{
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 10 * time.Minute,
		IdleTimeout:  60 * time.Second,
	}
	return r, nil
}

// Start begins serving. Non-blocking — runs in a goroutine.
func (r *Runner) Start() {
	go r.server.Serve(r.listener)
}

// Stop shuts down the HTTP server gracefully.
func (r *Runner) Stop(ctx context.Context) error {
	return r.server.Shutdown(ctx)
}

// Endpoint returns the HTTP URL the runner is listening on.
func (r *Runner) Endpoint() string {
	return "http://" + r.listener.Addr().String()
}

func (r *Runner) handleHealth(w http.ResponseWriter, req *http.Request) {
	if r.isBusy {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte("busy"))
		return
	}
	if err := r.adapter.Health(req.Context()); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(err.Error()))
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func (r *Runner) handleTask(w http.ResponseWriter, req *http.Request) {
	r.busy.Lock()
	if r.isBusy {
		r.busy.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error":"worker busy"}`))
		return
	}
	r.isBusy = true
	r.busy.Unlock()
	defer func() {
		r.busy.Lock()
		r.isBusy = false
		r.busy.Unlock()
	}()

	body, err := io.ReadAll(io.LimitReader(req.Body, 10<<20))
	if err != nil {
		writeAdapterError(w, http.StatusBadRequest, "read body: "+err.Error())
		return
	}
	var payload struct {
		Prompt string `json:"prompt"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		writeAdapterError(w, http.StatusBadRequest, "parse json: "+err.Error())
		return
	}

	result, err := r.adapter.SendTask(req.Context(), payload.Prompt)
	if err != nil {
		writeAdapterError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

func writeAdapterError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
