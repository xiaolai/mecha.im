package cli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"mecha.im/internal/adapter"
	"mecha.im/internal/workers"
)

// adapterRunners holds running adapter runners keyed by worker name.
// Needed so that workerStopCmd can shut them down.
var (
	adapterRunners   = make(map[string]*adapter.Runner)
	adapterRunnersMu sync.Mutex
)

// adapterStart creates and starts an in-process adapter runner.
func adapterStart(reg *workers.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	ac := e.Worker.Adapter

	// Resolve token reference from secrets.yml if raw api_key is empty.
	// api_key is json:"-" so it's never persisted to SQLite; on restart,
	// the token reference is the only way to recover the secret.
	if ac.APIKey == "" && ac.Token != "" {
		secretsPath, err := workers.DefaultSecretsPath()
		if err != nil {
			return fmt.Errorf("resolve secrets path: %w", err)
		}
		secrets, err := workers.LoadSecrets(secretsPath)
		if err != nil {
			return fmt.Errorf("load secrets for adapter token %q: %w", ac.Token, err)
		}
		resolved, err := secrets.Resolve(ac.Token)
		if err != nil {
			return fmt.Errorf("resolve adapter token %q: %w", ac.Token, err)
		}
		ac.APIKey = resolved
	}

	a, err := newAdapter(ac)
	if err != nil {
		return fmt.Errorf("create adapter: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.Health(ctx); err != nil {
		if setErr := reg.SetError(name, err.Error()); setErr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to set error state for %s: %v\n", name, setErr)
		}
		return fmt.Errorf("upstream health check: %w", err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	runner, err := adapter.NewRunner(a, logger)
	if err != nil {
		return fmt.Errorf("create runner: %w", err)
	}
	runner.Start()

	adapterRunnersMu.Lock()
	adapterRunners[name] = runner
	adapterRunnersMu.Unlock()

	endpoint := runner.Endpoint()
	return reg.SetRuntime(name, "", endpoint)
}

// adapterStop shuts down a running adapter runner.
func adapterStop(name string) {
	adapterRunnersMu.Lock()
	runner, ok := adapterRunners[name]
	if ok {
		delete(adapterRunners, name)
	}
	adapterRunnersMu.Unlock()
	if ok && runner != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		runner.Stop(ctx)
	}
}

func newAdapter(ac *workers.AdapterConfig) (adapter.Adapter, error) {
	switch ac.Type {
	case "ollama":
		return adapter.NewOllamaAdapter(ac.Upstream, ac.Model), nil
	case "openai":
		return adapter.NewOpenAIAdapter(ac.Upstream, ac.Model, ac.APIKey), nil
	default:
		return nil, fmt.Errorf("unknown adapter type: %s", ac.Type)
	}
}
