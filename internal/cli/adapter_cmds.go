package cli

import (
	"context"
	"fmt"
	"time"

	"mecha.im/internal/adapter"
	"mecha.im/internal/worker"
)

// adapterStart creates and starts an in-process adapter runner.
// Returns the runner endpoint URL.
func adapterStart(reg *worker.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	ac := e.Worker.Adapter

	a, err := newAdapter(ac)
	if err != nil {
		return fmt.Errorf("create adapter: %w", err)
	}

	// Check upstream health before starting
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.Health(ctx); err != nil {
		if setErr := reg.SetError(name, err.Error()); setErr != nil {
			fmt.Printf("warning: failed to set error state for %s: %v\n", name, setErr)
		}
		return fmt.Errorf("upstream health check: %w", err)
	}

	runner, err := adapter.NewRunner(a)
	if err != nil {
		return fmt.Errorf("create runner: %w", err)
	}
	runner.Start()

	endpoint := runner.Endpoint()
	return reg.SetRuntime(name, "", endpoint)
}

func newAdapter(ac *worker.AdapterConfig) (adapter.Adapter, error) {
	switch ac.Type {
	case "ollama":
		return adapter.NewOllamaAdapter(ac.Upstream, ac.Model), nil
	case "openai":
		return adapter.NewOpenAIAdapter(ac.Upstream, ac.Model, ac.APIKey), nil
	default:
		return nil, fmt.Errorf("unknown adapter type: %s", ac.Type)
	}
}
