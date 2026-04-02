package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
	"mecha.im/internal/workers"
)

func configCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "config [name]",
		Short: "Show resolved worker configuration",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			reg := registry()
			if len(args) == 1 {
				return showWorkerConfig(reg, args[0])
			}
			return showAllConfig(reg)
		},
	}
}

func showWorkerConfig(reg *workers.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	return printYAML(e.Worker)
}

func showAllConfig(reg *workers.Registry) error {
	entries := reg.List()
	if len(entries) == 0 {
		fmt.Println("no workers registered")
		return nil
	}
	for i, e := range entries {
		if i > 0 {
			fmt.Println("---")
		}
		if err := printYAML(e.Worker); err != nil {
			return err
		}
	}
	return nil
}

func printYAML(v any) error {
	enc := yaml.NewEncoder(os.Stdout)
	enc.SetIndent(2)
	if err := enc.Encode(v); err != nil {
		return fmt.Errorf("encode yaml: %w", err)
	}
	return nil
}
