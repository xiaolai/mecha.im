package cli

import (
	"fmt"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"mecha.im/internal/worker"
)

func workerCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "worker",
		Short: "Manage workers",
	}
	cmd.AddCommand(workerAddCmd())
	cmd.AddCommand(workerRemoveCmd())
	cmd.AddCommand(workerStartCmd())
	cmd.AddCommand(workerStopCmd())
	cmd.AddCommand(workerLsCmd())
	return cmd
}

func registry() *worker.Registry {
	r, err := worker.NewRegistry(worker.DefaultRegistryPath())
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	return r
}

func workerAddCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "add <path>",
		Short: "Add worker from YAML file or directory",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]
			reg := registry()
			info, err := os.Stat(path)
			if err != nil {
				return fmt.Errorf("stat path: %w", err)
			}
			if info.IsDir() {
				return addDir(reg, path)
			}
			return addFile(reg, path)
		},
	}
}

func addFile(reg *worker.Registry, path string) error {
	w, err := worker.LoadFile(path)
	if err != nil {
		return err
	}
	if err := reg.Add(w); err != nil {
		return err
	}
	fmt.Printf("added %s (%s)\n", w.Name, w.TypeLabel())
	return nil
}

func addDir(reg *worker.Registry, dir string) error {
	workers, err := worker.LoadDir(dir)
	if err != nil {
		return err
	}
	for _, w := range workers {
		if err := reg.Add(w); err != nil {
			return err
		}
		fmt.Printf("added %s (%s)\n", w.Name, w.TypeLabel())
	}
	return nil
}

func workerRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "remove <name>",
		Short: "Remove a worker",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			reg := registry()
			if err := reg.Remove(args[0]); err != nil {
				return err
			}
			fmt.Printf("removed %s\n", args[0])
			return nil
		},
	}
}

func workerStartCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "start <name>",
		Short: "Start a worker (offline -> online)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			reg := registry()
			if err := reg.Start(args[0]); err != nil {
				return err
			}
			fmt.Printf("started %s\n", args[0])
			return nil
		},
	}
}

func workerStopCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "stop <name>",
		Short: "Stop a worker (online -> offline)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			reg := registry()
			if err := reg.Stop(args[0]); err != nil {
				return err
			}
			fmt.Printf("stopped %s\n", args[0])
			return nil
		},
	}
}

func workerLsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "ls",
		Short: "List all workers",
		RunE: func(cmd *cobra.Command, args []string) error {
			reg := registry()
			entries := reg.List()
			if len(entries) == 0 {
				fmt.Println("no workers registered")
				return nil
			}
			tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(tw, "NAME\tTYPE\tSTATE\tENDPOINT\tHEALTH")
			for _, e := range entries {
				endpoint := "-"
				if e.Worker.Endpoint != "" {
					endpoint = e.Worker.Endpoint
				}
				health := checkEntryHealth(e)
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n",
					e.Worker.Name,
					e.Worker.TypeLabel(),
					e.State,
					endpoint,
					health,
				)
			}
			return tw.Flush()
		},
	}
}

func checkEntryHealth(e *worker.Entry) string {
	if e.State == worker.StateOffline {
		return "-"
	}
	if e.Worker.Endpoint == "" {
		return "-"
	}
	if e.State == worker.StateError {
		return strings.TrimSpace(e.Error)
	}
	err := worker.CheckHealth(e.Worker.Endpoint, 5*time.Second)
	if err != nil {
		return "unreachable"
	}
	return "ok"
}
