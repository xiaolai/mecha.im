package serve

import (
	"context"
	"crypto/subtle"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
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
	if s.sources != nil && s.events != nil {
		mux.HandleFunc("POST /webhook/{source}", s.handleWebhook)
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

	// Recover pending tasks from previous run
	ids, err := s.tasks.Pending(ctx)
	if err != nil {
		return fmt.Errorf("recover pending tasks: %w", err)
	}
	for _, id := range ids {
		select {
		case s.pending <- id:
			s.logger.Info("recovered task", "id", id)
		default:
			s.logger.Warn("pending queue full, skipping recovery", "id", id)
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

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Webhook paths rely on source-level auth (HMAC signature), not API key.
		// /health is always public for load-balancer probes.
		if s.apiKey == "" || r.URL.Path == "/health" ||
			(strings.HasPrefix(r.URL.Path, "/webhook/") && s.sources != nil && s.sources.Len() > 0) {
			next.ServeHTTP(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		key := r.Header.Get("X-API-Key")
		expected := []byte(s.apiKey)
		bearerMatch := subtle.ConstantTimeCompare([]byte(strings.TrimPrefix(auth, "Bearer ")), expected) == 1
		keyMatch := subtle.ConstantTimeCompare([]byte(key), expected) == 1
		if bearerMatch || keyMatch {
			next.ServeHTTP(w, r)
			return
		}
		writeError(w, http.StatusUnauthorized, "unauthorized")
	})
}
