package cli

import (
	"context"
	"fmt"
	"os"
	"time"

	"mecha.im/internal/store"
	"mecha.im/internal/worker"
)

func runWorkerChecks() bool {
	path := os.Getenv("MECHA_DB_PATH")
	if path == "" {
		p, err := store.DefaultDBPath()
		if err != nil {
			return true // already reported
		}
		path = p
	}
	db, err := store.Open(path)
	if err != nil {
		return true // already reported
	}
	defer db.Close()
	reg, err := worker.NewRegistry(db)
	if err != nil {
		return true // already reported
	}
	entries := reg.List()
	if len(entries) == 0 {
		fmt.Println("\nWorkers")
		printStatus("ok", "no workers registered")
		return true
	}
	secrets := loadSecretsQuiet()
	dc := dockerClientQuiet()
	if dc != nil {
		defer dc.Close()
	}
	fmt.Printf("\nWorkers (%d registered)\n", len(entries))
	ok := true
	for _, e := range entries {
		fmt.Printf("  %s (%s)\n", e.Worker.Name, e.Worker.TypeLabel())
		ok = checkWorkerEntry(e, secrets, dc) && ok
	}
	return ok
}

func checkWorkerEntry(e worker.Entry, secrets *worker.Secrets, dc *worker.DockerClient) bool {
	ok := true
	w := e.Worker
	if w.Docker != nil {
		ok = checkWorkerCwd(w) && ok
		ok = checkWorkerToken(w, secrets) && ok
		ok = checkWorkerImage(w, dc) && ok
	}
	if w.Adapter != nil {
		ok = checkAdapterUpstream(w) && ok
	}
	return ok
}

func checkWorkerCwd(w *worker.Worker) bool {
	if w.Docker.Cwd == "" {
		return true
	}
	info, err := os.Stat(w.Docker.Cwd)
	if err != nil {
		printStatus("fail", fmt.Sprintf("    cwd %s: %v", w.Docker.Cwd, err))
		return false
	}
	if !info.IsDir() {
		printStatus("fail", fmt.Sprintf("    cwd %s is not a directory", w.Docker.Cwd))
		return false
	}
	printStatus("ok", fmt.Sprintf("    cwd %s exists", w.Docker.Cwd))
	return true
}

func checkWorkerToken(w *worker.Worker, secrets *worker.Secrets) bool {
	if w.Docker.Token == "" {
		return true
	}
	if secrets == nil {
		printStatus("warn", fmt.Sprintf("    token %s — no secrets file", w.Docker.Token))
		return true
	}
	_, err := secrets.Resolve(w.Docker.Token)
	if err != nil {
		printStatus("fail", "    token "+w.Docker.Token+": "+err.Error())
		return false
	}
	printStatus("ok", "    token "+w.Docker.Token+" resolves")
	return true
}

func checkWorkerImage(w *worker.Worker, dc *worker.DockerClient) bool {
	if dc == nil {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	exists, err := dc.ImageExists(ctx, w.Docker.Image)
	if err != nil {
		printStatus("warn", "    image "+w.Docker.Image+": "+err.Error())
		return true
	}
	if !exists {
		printStatus("warn", "    image "+w.Docker.Image+" not found locally")
		return true
	}
	printStatus("ok", "    image "+w.Docker.Image+" available")
	return true
}

func checkAdapterUpstream(w *worker.Worker) bool {
	if err := worker.CheckHealth(w.Adapter.Upstream, 5*time.Second); err != nil {
		printStatus("warn", "    upstream "+w.Adapter.Upstream+" unreachable")
		return true
	}
	printStatus("ok", "    upstream "+w.Adapter.Upstream+" reachable")
	return true
}

func loadSecretsQuiet() *worker.Secrets {
	path, err := worker.DefaultSecretsPath()
	if err != nil {
		return nil
	}
	s, err := worker.LoadSecrets(path)
	if err != nil {
		return nil
	}
	return s
}

func dockerClientQuiet() *worker.DockerClient {
	dc, err := worker.NewDockerClient("")
	if err != nil {
		return nil
	}
	return dc
}
