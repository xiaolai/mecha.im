package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/source"
	"mecha.im/internal/worker"
)

func TestCron_TriggerGeneratesEvents(t *testing.T) {
	// Register a GenericSource named "cron-sim" to simulate cron-like events.
	// A goroutine will POST to /webhook/cron-sim every 200ms.
	// A worker matching source=cron-sim, on=[tick] will receive tasks.

	mock := mockWorker(`{"output":"cron task handled"}`)
	defer mock.Close()

	sources := source.NewRegistry()
	sources.Register(source.NewGenericSource("cron-sim", "X-Event-Type"))

	w := &worker.Worker{
		Name:     "cron-handler",
		Endpoint: mock.URL,
		Timeout:  30 * time.Second,
		Events: []worker.EventRule{{
			Source: "cron-sim",
			On:     []string{"tick"},
			Prompt: "Handle cron tick at {{.tick_time}}",
		}},
	}

	serverURL, cleanup := startTestServerWithSources(t, []*worker.Worker{w}, sources)
	defer cleanup()

	// Start a goroutine that POSTs tick events every 200ms.
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for i := 0; i < 10; i++ {
			<-ticker.C
			tickTime := time.Now().Format(time.RFC3339)
			payload, _ := json.Marshal(map[string]string{
				"tick_time": tickTime,
				"tick_id":   fmt.Sprintf("tick-%d", i),
			})

			req, err := http.NewRequest("POST", serverURL+"/webhook/cron-sim",
				strings.NewReader(string(payload)))
			if err != nil {
				continue
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Event-Type", "tick")

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				continue
			}
			resp.Body.Close()
		}
	}()

	// Wait for at least one task to complete.
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		body, status := apiGet(t, serverURL, "/tasks")
		if status == 200 {
			var tasks []map[string]any
			json.Unmarshal(body, &tasks)
			for _, tsk := range tasks {
				state, _ := tsk["state"].(string)
				if state == "completed" {
					<-done // wait for goroutine to finish
					return // success
				}
			}
		}
		time.Sleep(200 * time.Millisecond)
	}

	<-done
	t.Fatal("no cron-sim task reached completed state within timeout")
}

// startTestServerWithSources is a variant of startTestServer that accepts
// a pre-built source registry (for registering GenericSource etc.).
func startTestServerWithSources(t *testing.T, workers []*worker.Worker, sources *source.Registry) (serverURL string, cleanup func()) {
	t.Helper()
	return startTestServer(t, workers, sources)
}
