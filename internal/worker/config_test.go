package worker

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadFile(t *testing.T) {
	tests := []struct {
		name    string
		yaml    string
		want    func(*testing.T, *Worker)
		wantErr bool
	}{
		{
			name: "unmanaged worker",
			yaml: "name: api\nendpoint: http://localhost:8080\ntimeout: 5m\n",
			want: func(t *testing.T, w *Worker) {
				if w.Name != "api" {
					t.Errorf("name = %q, want %q", w.Name, "api")
				}
				if w.Endpoint != "http://localhost:8080" {
					t.Errorf("endpoint = %q", w.Endpoint)
				}
				if w.IsManaged() {
					t.Error("should not be managed")
				}
				if w.Timeout != 5*time.Minute {
					t.Errorf("timeout = %v, want 5m", w.Timeout)
				}
			},
		},
		{
			name: "managed worker with defaults",
			yaml: "name: sandbox\ndocker:\n  image: ghcr.io/test:latest\n",
			want: func(t *testing.T, w *Worker) {
				if !w.IsManaged() {
					t.Error("should be managed")
				}
				if w.Docker.Lifecycle != "disposable" {
					t.Errorf("lifecycle = %q, want disposable", w.Docker.Lifecycle)
				}
				if w.Docker.Port != 8080 {
					t.Errorf("port = %d, want 8080", w.Docker.Port)
				}
				if w.Timeout != 10*time.Minute {
					t.Errorf("timeout = %v, want 10m", w.Timeout)
				}
			},
		},
		{
			name:    "missing name",
			yaml:    "endpoint: http://localhost:8080\n",
			wantErr: true,
		},
		{
			name:    "missing endpoint and docker",
			yaml:    "name: broken\n",
			wantErr: true,
		},
		{
			name:    "docker without image",
			yaml:    "name: broken\ndocker:\n  lifecycle: disposable\n",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "worker.yml")
			if err := os.WriteFile(path, []byte(tt.yaml), 0o644); err != nil {
				t.Fatal(err)
			}
			w, err := LoadFile(path)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.want != nil {
				tt.want(t, w)
			}
		})
	}
}

func TestEnvInterpolation(t *testing.T) {
	t.Setenv("TEST_ENDPOINT", "http://injected:9090")
	yaml := "name: envtest\nendpoint: ${TEST_ENDPOINT}\n"
	path := filepath.Join(t.TempDir(), "worker.yml")
	if err := os.WriteFile(path, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	w, err := LoadFile(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if w.Endpoint != "http://injected:9090" {
		t.Errorf("endpoint = %q, want http://injected:9090", w.Endpoint)
	}
}

func TestLoadDir(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{
		"a.yml":      "name: alpha\nendpoint: http://a:80\n",
		"b.yaml":     "name: beta\nendpoint: http://b:80\n",
		"readme.txt": "not a yaml file",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	workers, err := LoadDir(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(workers) != 2 {
		t.Errorf("got %d workers, want 2", len(workers))
	}
}

func TestTypeLabel(t *testing.T) {
	managed := &Worker{Name: "m", Docker: &DockerConfig{Image: "x"}}
	if managed.TypeLabel() != "managed" {
		t.Errorf("managed TypeLabel = %q", managed.TypeLabel())
	}
	live := &Worker{Name: "l", Endpoint: "http://x"}
	if live.TypeLabel() != "live" {
		t.Errorf("live TypeLabel = %q", live.TypeLabel())
	}
}
