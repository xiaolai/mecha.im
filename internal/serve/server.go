package serve

import (
	"context"
	"expvar"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"mecha.im/internal/logs"
	"mecha.im/internal/events"
	"mecha.im/internal/source"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
	"mecha.im/internal/writeback"
)

// Server is the mecha HTTP daemon that accepts tasks and dispatches to workers.
type Server struct {
	reg       *workers.Registry
	tasks     *tasks.Store
	events    *events.Store
	sources   *source.Registry
	writeback *writeback.Client
	docker    *workers.DockerClient
	limiter   *RateLimiter
	logs      *logs.Store
	pending    chan string
	dispatchWg sync.WaitGroup
	addr       string
	apiKey     string
	httpSrv    *http.Server
	logger     *slog.Logger
}

// Config holds server startup parameters.
type Config struct {
	Registry  *workers.Registry
	Tasks     *tasks.Store
	Events    *events.Store
	Sources   *source.Registry
	WriteBack *writeback.Client
	Docker    *workers.DockerClient
	Limiter   *RateLimiter
	Logs      *logs.Store
	Addr      string
	APIKey    string
	Logger    *slog.Logger
}

// New creates a server but does not start it.
func New(cfg Config) *Server {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Registry == nil || cfg.Tasks == nil {
		panic("serve.New: Registry and Tasks must not be nil")
	}
	s := &Server{
		reg:       cfg.Registry,
		tasks:     cfg.Tasks,
		events:    cfg.Events,
		sources:   cfg.Sources,
		writeback: cfg.WriteBack,
		docker:    cfg.Docker,
		limiter:   cfg.Limiter,
		logs:      cfg.Logs,
		pending:   make(chan string, 256),
		addr:      cfg.Addr,
		apiKey:    cfg.APIKey,
		logger:    cfg.Logger,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /task", s.handlePostTask)
	mux.HandleFunc("GET /task/{id}", s.handleGetTask)
	mux.HandleFunc("GET /tasks", s.handleListTasks)
	mux.HandleFunc("GET /workers", s.handleListWorkers)
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.Handle("GET /debug/vars", expvar.Handler())
	mux.HandleFunc("GET /metrics", prometheusHandler())
	if s.logs != nil {
		mux.HandleFunc("GET /logs", s.handleLogs)
	}
	if s.sources != nil && s.events != nil {
		mux.HandleFunc("POST /webhook/{source}", s.handleWebhook)
		mux.HandleFunc("GET /webhook/{source}", s.handleWebhook)
		mux.HandleFunc("GET /events", s.handleListEvents)
		mux.HandleFunc("GET /event/{id}", s.handleGetEvent)
	}

	s.httpSrv = &http.Server{
		Addr:              cfg.Addr,
		Handler:           s.authMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB — prevents oversized header DoS
	}
	return s
}

// Start begins serving HTTP and the dispatch loop. Blocks until ctx is cancelled.
func (s *Server) Start(ctx context.Context) error {
	// Cleanup orphaned disposable containers from previous crashes
	if s.docker != nil {
		removed, cleanupErr := s.docker.CleanupOrphanDisposables(ctx)
		if cleanupErr != nil {
			s.logger.Warn("orphan cleanup failed", "err", cleanupErr)
		} else if removed > 0 {
			s.logger.Info("cleaned up orphan disposable containers", "count", removed)
		}
	}

	// Start dispatch loop first so recovered tasks are consumed
	go s.dispatchLoop(ctx)

	// Start retry loop — re-enqueues failed tasks after backoff
	go s.retryLoop(ctx)

	// Start rate limiter cleanup — prevents unbounded bucket growth
	if s.limiter != nil {
		go s.limiterCleanupLoop(ctx)
	}

	// Start pending scan — catches orphaned tasks not in the channel
	go s.pendingLoop(ctx)

	// Start reconciliation loop — detects registry/Docker state drift
	if s.docker != nil {
		go s.reconcileLoop(ctx, s.docker, 60*time.Second)
	}

	if err := s.recoverTasks(ctx); err != nil {
		return fmt.Errorf("recover pending tasks: %w", err)
	}
	s.recoverEvents(ctx)

	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	s.logger.Info("serving", "addr", ln.Addr().String())

	errCh := make(chan error, 1)
	go func() { errCh <- s.httpSrv.Serve(ln) }()

	select {
	case <-ctx.Done():
		s.logger.Info("shutting down")
		shutCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		s.httpSrv.Shutdown(shutCtx)
		// Wait for in-flight dispatches to finish (bounded by shutCtx)
		done := make(chan struct{})
		go func() { s.dispatchWg.Wait(); close(done) }()
		select {
		case <-done:
			s.logger.Info("all dispatches drained")
		case <-shutCtx.Done():
			s.logger.Warn("shutdown timeout — some dispatches may still be running")
		}
		return nil
	case err := <-errCh:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	}
}

