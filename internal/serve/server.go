package serve

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"mecha.im/internal/task"
	"mecha.im/internal/worker"
)

// Server is the mecha HTTP daemon that accepts tasks and dispatches to workers.
type Server struct {
	reg     *worker.Registry
	tasks   *task.Store
	pending chan string
	addr    string
	apiKey  string
	httpSrv *http.Server
	logger  *slog.Logger
}

// Config holds server startup parameters.
type Config struct {
	Registry *worker.Registry
	Tasks    *task.Store
	Addr     string
	APIKey   string
	Logger   *slog.Logger
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
		reg:     cfg.Registry,
		tasks:   cfg.Tasks,
		pending: make(chan string, 256),
		addr:    cfg.Addr,
		apiKey:  cfg.APIKey,
		logger:  cfg.Logger,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /task", s.handlePostTask)
	mux.HandleFunc("GET /task/{id}", s.handleGetTask)
	mux.HandleFunc("GET /tasks", s.handleListTasks)
	mux.HandleFunc("GET /workers", s.handleListWorkers)
	mux.HandleFunc("GET /health", s.handleHealth)

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

	go s.dispatchLoop(ctx)

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
		if s.apiKey == "" || r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		key := r.Header.Get("X-API-Key")
		if auth == "Bearer "+s.apiKey || key == s.apiKey {
			next.ServeHTTP(w, r)
			return
		}
		writeError(w, http.StatusUnauthorized, "unauthorized")
	})
}
