package serve

import (
	"context"
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
	reg          *workers.Registry
	tasks        *tasks.Store
	events       *events.Store
	sources      *source.Registry
	writeback    *writeback.Client
	docker       *workers.DockerClient
	limiter      *RateLimiter
	logs         *logs.Store
	secrets      *workers.Secrets
	pending      chan string
	dispatchWg   sync.WaitGroup
	addr         string
	apiKey       string
	drainTimeout time.Duration
	httpSrv      *http.Server
	logger       *slog.Logger
}

// Config holds server startup parameters.
type Config struct {
	Registry     *workers.Registry
	Tasks        *tasks.Store
	Events       *events.Store
	Sources      *source.Registry
	WriteBack    *writeback.Client
	Docker       *workers.DockerClient
	Limiter      *RateLimiter
	Logs         *logs.Store
	Addr         string
	APIKey       string
	Logger       *slog.Logger
	// DrainTimeout is how long Serve waits for in-flight dispatches after
	// receiving a shutdown signal. Defaults to 10 minutes if zero.
	DrainTimeout time.Duration
	// QueueSize is the pending task channel capacity. Defaults to 256 if zero.
	QueueSize int
}

// New creates a server but does not start it.
func New(cfg Config) *Server {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Registry == nil || cfg.Tasks == nil {
		panic("serve.New: Registry and Tasks must not be nil")
	}
	drain := cfg.DrainTimeout
	if drain == 0 {
		drain = 10 * time.Minute
	}
	queueSize := cfg.QueueSize
	if queueSize <= 0 {
		queueSize = 256
	}
	s := &Server{
		reg:          cfg.Registry,
		tasks:        cfg.Tasks,
		events:       cfg.Events,
		sources:      cfg.Sources,
		writeback:    cfg.WriteBack,
		docker:       cfg.Docker,
		limiter:      cfg.Limiter,
		logs:         cfg.Logs,
		pending:      make(chan string, queueSize),
		addr:         cfg.Addr,
		apiKey:       cfg.APIKey,
		drainTimeout: drain,
		logger:       cfg.Logger,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /task", s.handlePostTask)
	mux.HandleFunc("GET /task/{id}", s.handleGetTask)
	mux.HandleFunc("GET /tasks", s.handleListTasks)
	mux.HandleFunc("GET /workers", s.handleListWorkers)
	mux.HandleFunc("GET /health", s.handleHealth)
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
	// Cache secrets once at startup for container builds (M-20: avoid re-reading
	// ~/.mecha/secrets.yml on every disposable container creation).
	if secPath, err := workers.DefaultSecretsPath(); err == nil {
		if sec, err := workers.LoadSecrets(secPath); err == nil {
			s.secrets = sec
		} else {
			s.logger.Warn("load secrets", "err", err)
		}
	}

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

	// Start write-back retry loop — retries events whose write-back failed
	// transiently (GitHub rate limit, network error). Without this loop,
	// failed write-backs leave events permanently in "dispatched" state.
	if s.events != nil {
		go s.writeBackRetryLoop(ctx)
	}

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
		s.logger.Info("shutting down", "drain_timeout", s.drainTimeout)
		shutCtx, cancel := context.WithTimeout(context.Background(), s.drainTimeout)
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

