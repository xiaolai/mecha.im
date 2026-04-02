package integration

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/serve"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

func TestAuth_APIKeyEnforcement(t *testing.T) {
	const apiKey = "test-key-123"
	const ghSecret = "github-hmac-secret"

	mock := mockWorker(`{"output":"ok"}`)
	defer mock.Close()

	// Build server manually with APIKey set.
	dbPath := tempDBPath(t)
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("create registry: %v", err)
	}
	w := &workers.Worker{
		Name:     "auth-worker",
		Endpoint: mock.URL,
		Timeout:  30 * time.Second,
	}
	if err := reg.Add(w); err != nil {
		t.Fatalf("add worker: %v", err)
	}
	if err := reg.Start(w.Name); err != nil {
		t.Fatalf("start worker: %v", err)
	}

	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)

	// Register both an authenticated source (GitHub) and a non-authenticated
	// source (GenericSource).
	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))
	sources.Register(source.NewGenericSource("generic", "X-Event-Type"))

	port := findFreePort(t)
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	srv := serve.New(serve.Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Sources:  sources,
		APIKey:   apiKey,
		Addr:     addr,
	})

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()

	serverURL := fmt.Sprintf("http://%s", addr)
	waitForServerHealth(t, serverURL, 5*time.Second)
	defer func() {
		cancel()
		<-errCh
		db.Close()
	}()

	tests := []struct {
		name       string
		method     string
		path       string
		headers    map[string]string
		body       []byte
		wantStatus int
	}{
		{
			name:       "health_no_key",
			method:     "GET",
			path:       "/health",
			wantStatus: 200,
		},
		{
			name:       "metrics_no_key",
			method:     "GET",
			path:       "/metrics",
			wantStatus: 200,
		},
		{
			name:       "workers_no_key",
			method:     "GET",
			path:       "/workers",
			wantStatus: 401,
		},
		{
			name:   "workers_bearer_auth",
			method: "GET",
			path:   "/workers",
			headers: map[string]string{
				"Authorization": "Bearer " + apiKey,
			},
			wantStatus: 200,
		},
		{
			name:   "workers_x_api_key",
			method: "GET",
			path:   "/workers",
			headers: map[string]string{
				"X-API-Key": apiKey,
			},
			wantStatus: 200,
		},
		{
			name:   "workers_wrong_key",
			method: "GET",
			path:   "/workers",
			headers: map[string]string{
				"Authorization": "Bearer wrong-key",
			},
			wantStatus: 401,
		},
		{
			name:   "github_webhook_valid_hmac_no_api_key",
			method: "POST",
			path:   "/webhook/github",
			headers: func() map[string]string {
				body := prWebhookPayload("owner", "repo", 1)
				return map[string]string{
					"Content-Type":      "application/json",
					"X-GitHub-Event":    "pull_request",
					"X-GitHub-Delivery": "auth-test-delivery-001",
					"X-Hub-Signature-256": signGitHub(ghSecret, body),
				}
			}(),
			body:       prWebhookPayload("owner", "repo", 1),
			wantStatus: 202,
		},
		{
			name:   "generic_webhook_no_api_key",
			method: "POST",
			path:   "/webhook/generic",
			headers: map[string]string{
				"Content-Type": "application/json",
				"X-Event-Type": "test",
			},
			body:       []byte(`{"data":"hello"}`),
			wantStatus: 401,
		},
		{
			name:   "generic_webhook_with_api_key",
			method: "POST",
			path:   "/webhook/generic",
			headers: map[string]string{
				"Content-Type":  "application/json",
				"X-Event-Type":  "test",
				"Authorization": "Bearer " + apiKey,
			},
			body:       []byte(`{"data":"hello"}`),
			wantStatus: 202,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var bodyReader io.Reader
			if tt.body != nil {
				bodyReader = bytes.NewReader(tt.body)
			}

			req, err := http.NewRequest(tt.method, serverURL+tt.path, bodyReader)
			if err != nil {
				t.Fatalf("create request: %v", err)
			}
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			defer resp.Body.Close()
			io.ReadAll(resp.Body)

			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
		})
	}
}
