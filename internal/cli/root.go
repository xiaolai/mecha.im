package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var Version = "dev"

func Execute() {
	root := &cobra.Command{
		Use:   "mecha",
		Short: "Mecha turns GitHub events into LLM tasks",
	}
	root.AddCommand(workerCmd())
	root.AddCommand(configCmd())
	root.AddCommand(versionCmd())
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
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
