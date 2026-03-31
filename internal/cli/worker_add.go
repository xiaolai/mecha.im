package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"mecha.im/internal/worker"
)

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
