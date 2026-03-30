package cli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"
	"mecha.im/internal/serve"
	"mecha.im/internal/store"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
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

			logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
				Level: slog.LevelInfo,
			}))

			srv := serve.New(serve.Config{
				Registry: reg,
				Tasks:    tasks,
				Addr:     addr,
				APIKey:   apiKey,
				Logger:   logger,
			})

			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			return srv.Start(ctx)
		},
	}
	cmd.Flags().StringVar(&addr, "addr", "127.0.0.1:8080", "listen address")
	cmd.Flags().StringVar(&apiKey, "api-key", "", "API key for authentication (empty = no auth)")
	return cmd
}
