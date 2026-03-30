package cli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"
	"mecha.im/internal/event"
	"mecha.im/internal/serve"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
	"mecha.im/internal/writeback"
)

func serveCmd() *cobra.Command {
	var addr, apiKey string
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start the mecha HTTP server",
		RunE: func(cmd *cobra.Command, args []string) error {
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

			reg, err := worker.NewRegistry(db)
			if err != nil {
				return fmt.Errorf("load registry: %w", err)
			}
			tasks := task.NewStore(db)
			events := event.NewStore(db)

			logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
				Level: slog.LevelInfo,
			}))

			// Load secrets for GitHub adapter + write-back
			secretsPath, err := worker.DefaultSecretsPath()
			if err != nil {
				return fmt.Errorf("resolve secrets path: %w", err)
			}
			secrets, err := worker.LoadSecrets(secretsPath)
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

			// Write-back client
			var wb *writeback.Client
			if ghToken != "" {
				wb = writeback.NewClient(ghToken, logger)
			}

			srv := serve.New(serve.Config{
				Registry:  reg,
				Tasks:     tasks,
				Events:    events,
				Sources:   sources,
				WriteBack: wb,
				Addr:      addr,
				APIKey:    apiKey,
				Logger:    logger,
			})

			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			return srv.Start(ctx)
		},
	}
	cmd.Flags().StringVar(&addr, "addr", "127.0.0.1:8080", "listen address")
	cmd.Flags().StringVar(&apiKey, "api-key", "", "API key for authentication")
	return cmd
}
