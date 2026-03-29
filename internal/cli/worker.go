package cli

import (
	"fmt"
	"os"
	"sync"
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
	path, err := worker.DefaultRegistryPath()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	r, err := worker.NewRegistry(path)
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
	// Preflight: check for duplicates before committing any.
	for _, w := range workers {
		if _, exists := reg.Get(w.Name); exists {
			return fmt.Errorf("worker %q already exists, aborting batch add", w.Name)
		}
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
			name := args[0]
			if err := reg.Start(name); err != nil {
				return err
			}
			// For live workers, verify health after starting.
			e, ok := reg.Get(name)
			if ok && e.Worker.Endpoint != "" {
				if err := worker.CheckHealth(e.Worker.Endpoint, 5*time.Second); err != nil {
					_ = reg.SetError(name, err.Error())
					fmt.Printf("started %s (warning: health check failed)\n", name)
					return nil
				}
			}
			fmt.Printf("started %s\n", name)
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
			probeResults := probeHealthConcurrent(entries)
			tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(tw, "NAME\tTYPE\tSTATE\tENDPOINT\tHEALTH")
			for i, e := range entries {
				endpoint := "-"
				if e.Worker.Endpoint != "" {
					endpoint = e.Worker.Endpoint
				}
				health := probeResults[i]
				// Transition to error state if probe failed on an online worker.
				if health == "unreachable" && e.State == worker.StateOnline {
					_ = reg.SetError(e.Worker.Name, "health check failed")
				}
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

func probeHealthConcurrent(entries []worker.Entry) []string {
	results := make([]string, len(entries))
	var wg sync.WaitGroup
	for i, e := range entries {
		if e.State == worker.StateOffline || e.Worker.Endpoint == "" {
			results[i] = "-"
			continue
		}
		if e.State == worker.StateError {
			results[i] = worker.RedactSecrets(e.Error)
			continue
		}
		wg.Add(1)
		go func(idx int, endpoint string) {
			defer wg.Done()
			if err := worker.CheckHealth(endpoint, 5*time.Second); err != nil {
				results[idx] = "unreachable"
			} else {
				results[idx] = "ok"
			}
		}(i, e.Worker.Endpoint)
	}
	wg.Wait()
	return results
}
