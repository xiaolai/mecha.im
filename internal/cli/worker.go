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
			if e.Worker.IsSSH() && e.State != worker.StateOffline {
				if err := sshStop(reg, name); err != nil {
					fmt.Fprintf(os.Stderr, "warning: ssh cleanup for %s: %v\n", name, err)
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
			if e.Worker.IsSSH() {
				if err := sshStart(reg, name); err != nil {
					return err
				}
				fmt.Printf("started %s (ssh/%s)\n", name, e.Worker.SSH.Mode)
				return nil
			}
			if e.Worker.IsAdapter() {
				return fmt.Errorf("adapter workers run in-process and must be started via 'mecha serve' (not 'worker start')")
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
			if e.Worker.IsSSH() {
				if err := sshStop(reg, name); err != nil {
					return err
				}
				fmt.Printf("stopped %s (ssh)\n", name)
				return nil
			}
			if e.Worker.IsAdapter() {
				adapterStop(name)
			}
			if err := reg.Stop(name); err != nil {
				return err
			}
			fmt.Printf("stopped %s\n", name)
			return nil
		},
	}
}
