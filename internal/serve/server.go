package serve

import (
	"context"
	"expvar"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"mecha.im/internal/event"
	"mecha.im/internal/source"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
	"mecha.im/internal/writeback"
)

// Server is the mecha HTTP daemon that accepts tasks and dispatches to workers.
type Server struct {
	reg       *worker.Registry
	tasks     *task.Store
	events    *event.Store
	sources   *source.Registry
	writeback *writeback.Client
	docker    *worker.DockerClient
	limiter   *RateLimiter
	pending   chan string
	addr      string
	apiKey    string
	httpSrv   *http.Server
	logger    *slog.Logger
}

// Config holds server startup parameters.
type Config struct {
	Registry  *worker.Registry
	Tasks     *task.Store
	Events    *event.Store
	Sources   *source.Registry
	WriteBack *writeback.Client
	Docker    *worker.DockerClient
	Limiter   *RateLimiter
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
	}
	return s
}

// Start begins serving HTTP and the dispatch loop. Blocks until ctx is cancelled.
func (s *Server) Start(ctx context.Context) error {
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

	// Recover pending tasks from previous run
	ids, err := s.tasks.Pending(ctx)
	if err != nil {
		return fmt.Errorf("recover pending tasks: %w", err)
	}
	for _, id := range ids {
		// Check idempotency: if a task with the same dedup_key already completed,
		// skip re-dispatch to prevent duplicate write-back (e.g., duplicate PR comments).
		t, getErr := s.tasks.Get(ctx, id)
		if getErr != nil {
			s.logger.Warn("recover: get task failed", "id", id, "err", getErr)
			continue
		}
		if t.DedupKey != "" {
			dup, dupErr := s.tasks.HasCompletedDedup(ctx, t.DedupKey)
			if dupErr != nil {
				s.logger.Warn("recover: dedup check failed", "id", id, "err", dupErr)
				continue
			}
			if dup {
				tasksDedupSkip.Add(1)
				s.logger.Info("recover: skipping duplicate task", "id", id, "dedup_key", t.DedupKey)
				if failErr := s.tasks.Fail(ctx, id, "skipped: duplicate of completed task"); failErr != nil {
					s.logger.Warn("recover: fail dedup task", "id", id, "err", failErr)
				}
				continue
			}
		}
		select {
		case s.pending <- id:
			tasksRecovered.Add(1)
			s.logger.Info("recovered task", "id", id)
		default:
			s.logger.Warn("pending queue full, skipping recovery", "id", id)
		}
	}

	// Recover events stuck in "received" state (crashed before matching).
	// Re-run matchAndHydrate if the source is still registered; otherwise
	// mark as failed for manual review.
	if s.events != nil && s.sources != nil {
		stuckIDs, err := s.events.Received(ctx)
		if err != nil {
			s.logger.Error("recover received events", "err", err)
		} else {
			for _, eid := range stuckIDs {
				ev, err := s.events.Get(ctx, eid)
				if err != nil {
					s.logger.Error("recover: get event", "event", eid, "err", err)
					continue
				}
				src, ok := s.sources.Get(ev.Source)
				if !ok {
					// Source no longer registered — mark failed
					if err := s.events.SetFailed(ctx, eid); err != nil {
						s.logger.Error("recover: fail event", "event", eid, "err", err)
					}
					s.logger.Warn("recovered stuck event (source gone, marked failed)", "event", eid, "source", ev.Source)
					continue
				}
				s.logger.Info("recovering stuck event", "event", eid, "source", ev.Source)
				go func(ev *event.Event, src source.Source) {
					rctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
					defer cancel()
					s.matchAndHydrate(rctx, ev, src)
				}(ev, src)
			}
		}
	}

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
		return nil
	case err := <-errCh:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	}
}

