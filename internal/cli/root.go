package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"mecha.im/internal/worker"
)

// Version is set at build time via -ldflags.
var Version = "dev"

// Execute runs the root Cobra command. Calls os.Exit(1) on error.
func Execute() {
	root := &cobra.Command{
		Use:   "mecha",
		Short: "Mecha turns GitHub events into LLM tasks",
	}
	root.AddCommand(workerCmd())
	root.AddCommand(configCmd())
	root.AddCommand(serveCmd())
	root.AddCommand(versionCmd())
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, worker.RedactSecrets(err.Error()))
		os.Exit(1)
	}
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println("mecha", Version)
		},
	}
}
