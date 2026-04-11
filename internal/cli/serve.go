package cli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"mecha.im/internal/logs"
	"mecha.im/internal/events"
	"mecha.im/internal/serve"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
	"mecha.im/internal/writeback"
)

func serveCmd() *cobra.Command {
	var addr, apiKey string
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start the mecha HTTP server",
		RunE: func(cmd *cobra.Command, args []string) error {
			// Load server config (~/.mecha/config.yml)
			srvCfg, err := workers.LoadServerConfig()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}
			// CLI flags override config file; config file overrides defaults.
			if !cmd.Flags().Changed("addr") {
				addr = srvCfg.Addr
			}
			if !cmd.Flags().Changed("api-key") && srvCfg.APIKey != "" {
				apiKey = srvCfg.APIKey
			}

			path := os.Getenv("MECHA_DB_PATH")
			if path == "" {
				var err error
				path, err = store.DefaultDBPath()
				if err != nil {
					return err
				}
			}
			db, err := store.Open(path)
			if err != nil {
				return fmt.Errorf("open database: %w", err)
			}
			defer db.Close()

			reg, err := workers.NewRegistry(db)
			if err != nil {
				return fmt.Errorf("load registry: %w", err)
			}
			taskStore := tasks.NewStore(db)
			evStore := events.NewStore(db)
			auditLog := logs.NewStore(db, nil)

			logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
				Level: slog.LevelInfo,
			}))

			// Load secrets for GitHub adapter + write-back
			secretsPath, err := workers.DefaultSecretsPath()
			if err != nil {
				return fmt.Errorf("resolve secrets path: %w", err)
			}
			secrets, err := workers.LoadSecrets(secretsPath)
			if err != nil {
				// LoadSecrets already returns empty for missing file;
				// other errors (bad permissions, invalid YAML) are fatal.
				return fmt.Errorf("load secrets: %w", err)
			}

			// Register event sources
			sources := source.NewRegistry()
			ghToken := secrets.GitHub.Token
			ghSecret := secrets.GitHub.WebhookSecret
			if ghToken != "" || ghSecret != "" {
				if ghSecret == "" {
					return fmt.Errorf("github.webhook_secret is required in secrets.yml when github source is enabled (set github.webhook_secret or remove github.token to disable)")
				}
				sources.Register(source.NewGitHubSource(ghSecret, ghToken))
				logger.Info("github source registered")
			}

			if glSecret := secrets.GitLab.WebhookSecret; glSecret != "" {
				sources.Register(source.NewGitLabSource(glSecret))
				logger.Info("gitlab source registered")
			}

			if slackSecret := secrets.Slack.SigningSecret; slackSecret != "" {
				sources.Register(source.NewSlackSource(slackSecret))
				logger.Info("slack source registered")
			}

			if tgSecret := secrets.Telegram.SecretToken; tgSecret != "" {
				sources.Register(source.NewTelegramSource(tgSecret))
				logger.Info("telegram source registered")
			}

			// Write-back client + responder registration
			var wb *writeback.Client
			if ghToken != "" {
				wb = writeback.NewClient(ghToken, logger)
				sources.RegisterResponder(wb)
			}

			// Warn if binding to non-loopback without authentication
			if apiKey == "" && !isLoopback(addr) {
				logger.Warn("WARNING: serving on non-loopback address without API key — all endpoints are unauthenticated",
					"addr", addr)
			}

			// Rate limiter: 2 req/s per worker, burst of 5
			limiter := serve.NewRateLimiter(2.0, 5)

			// MECHA_DRAIN_TIMEOUT controls how long shutdown waits for
			// in-flight LLM dispatches. Default 10m; override for long tasks.
			drainTimeout := 10 * time.Minute
			if v := os.Getenv("MECHA_DRAIN_TIMEOUT"); v != "" {
				if d, err := time.ParseDuration(v); err == nil {
					drainTimeout = d
				} else {
					logger.Warn("invalid MECHA_DRAIN_TIMEOUT, using default", "value", v, "default", drainTimeout)
				}
			}

			srv := serve.New(serve.Config{
				Registry:     reg,
				Tasks:        taskStore,
				Events:       evStore,
				Sources:      sources,
				WriteBack:    wb,
				Limiter:      limiter,
				Logs:         auditLog,
				Addr:         addr,
				APIKey:       apiKey,
				Logger:       logger,
				DrainTimeout: drainTimeout,
			})

			// Auto-start adapter workers (in-process, need long-lived server)
			for _, entry := range reg.List() {
				if entry.Worker.IsAdapter() && entry.State == workers.StateOffline {
					if err := adapterStart(reg, entry.Worker.Name); err != nil {
						logger.Warn("adapter start failed", "worker", entry.Worker.Name, "err", err)
					} else {
						logger.Info("adapter started", "worker", entry.Worker.Name, "type", entry.Worker.Adapter.Type)
					}
				}
			}

			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			// SIGHUP: hot-reload secrets.yml without restarting.
			sigHUP := make(chan os.Signal, 1)
			signal.Notify(sigHUP, syscall.SIGHUP)
			go func() {
				for {
					select {
					case <-sigHUP:
						if err := srv.ReloadSecrets(secretsPath); err != nil {
							logger.Error("reload secrets", "err", err)
						}
					case <-ctx.Done():
						return
					}
				}
			}()

			err = srv.Start(ctx)

			// Stop all in-process adapter runners after server shutdown.
			adapterRunnersMu.Lock()
			names := make([]string, 0, len(adapterRunners))
			for n := range adapterRunners {
				names = append(names, n)
			}
			adapterRunnersMu.Unlock()
			for _, n := range names {
				adapterStop(n)
				logger.Info("adapter stopped", "worker", n)
			}

			return err
		},
	}
	cmd.Flags().StringVar(&addr, "addr", "127.0.0.1:21212", "listen address")
	cmd.Flags().StringVar(&apiKey, "api-key", "", "API key for authentication")
	return cmd
}
