package cli

import (
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"mecha.im/internal/store"
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
	path := os.Getenv("MECHA_DB_PATH")
	if path == "" {
		var err error
		path, err = store.DefaultDBPath()
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	}
	db, err := store.Open(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	r, err := worker.NewRegistry(db)
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
		return fmt.Errorf("load %s: %w", path, err)
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
			name := args[0]
			e, ok := reg.Get(name)
			if !ok {
				return fmt.Errorf("worker %q not found", name)
			}
			if e.Worker.IsManaged() {
				if err := dockerRemove(reg, name); err != nil {
					return fmt.Errorf("cleanup container: %w", err)
				}
			}
			if err := reg.Remove(name); err != nil {
				return err
			}
			fmt.Printf("removed %s\n", name)
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
			e, ok := reg.Get(name)
			if !ok {
				return fmt.Errorf("worker %q not found", name)
			}
			if e.State != worker.StateOffline {
				return fmt.Errorf("worker %q must be offline to start (current: %s)", name, e.State)
			}
			if e.Worker.IsManaged() {
				if err := dockerStart(reg, name); err != nil {
					return err
				}
				fmt.Printf("started %s (container)\n", name)
				return nil
			}
			if err := reg.Start(name); err != nil {
				return err
			}
			if e.Worker.Endpoint != "" {
				if err := worker.CheckHealth(e.Worker.Endpoint, 5*time.Second); err != nil {
					if setErr := reg.SetError(name, err.Error()); setErr != nil {
						fmt.Fprintf(os.Stderr, "warning: failed to set error state for %s: %v\n", name, setErr)
					}
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
			name := args[0]
			e, ok := reg.Get(name)
			if !ok {
				return fmt.Errorf("worker %q not found", name)
			}
			if e.Worker.IsManaged() && e.ContainerID != "" {
				if err := dockerStop(reg, name); err != nil {
					return err
				}
				fmt.Printf("stopped %s (container)\n", name)
				return nil
			}
			if err := reg.Stop(name); err != nil {
				return err
			}
			fmt.Printf("stopped %s\n", name)
			return nil
		},
	}
}
