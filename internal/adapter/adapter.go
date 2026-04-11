package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
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
	busy     atomic.Bool
	logger   *slog.Logger
}

// NewRunner creates a runner for the given adapter.
// The runner listens on a random localhost port.
func NewRunner(a Adapter, logger *slog.Logger) (*Runner, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}
	if logger == nil {
		logger = slog.Default()
	}
	r := &Runner{adapter: a, listener: ln, logger: logger}
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
	go func() {
		if err := r.server.Serve(r.listener); err != nil && err != http.ErrServerClosed {
			r.logger.Error("adapter server exited", "adapter", r.adapter.Name(), "err", err)
		}
	}()
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
	if r.busy.Load() {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte("busy"))
		return
	}
	if err := r.adapter.Health(req.Context()); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte("upstream unavailable"))
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func (r *Runner) handleTask(w http.ResponseWriter, req *http.Request) {
	if !r.busy.CompareAndSwap(false, true) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error":"worker busy"}`))
		return
	}
	defer r.busy.Store(false)

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
		r.logger.Error("adapter task failed", "adapter", r.adapter.Name(), "err", err)
		writeAdapterError(w, http.StatusInternalServerError, "task failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

func writeAdapterError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	data, _ := json.Marshal(map[string]string{"error": msg})
	w.Write(data)
}
