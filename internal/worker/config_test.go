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
				if w.Docker.Lifecycle != "persistent" {
					t.Errorf("lifecycle = %q, want persistent", w.Docker.Lifecycle)
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
		{
			name:    "unknown yaml field rejected",
			yaml:    "name: bad\nendpont: http://typo\n",
			wantErr: true,
		},
		{
			name:    "invalid lifecycle rejected",
			yaml:    "name: bad\ndocker:\n  image: x\n  lifecycle: ephemeral\n",
			wantErr: true,
		},
		{
			name: "docker env vars accepted",
			yaml: "name: ok\ndocker:\n  image: x\n  env:\n    CLAUDE_MODEL: claude-sonnet-4-6\n",
			want: func(t *testing.T, w *Worker) {
				if w.Docker.Env["CLAUDE_MODEL"] != "claude-sonnet-4-6" {
					t.Errorf("env = %v", w.Docker.Env)
				}
			},
		},
		{
			name: "docker token accepted",
			yaml: "name: ok\ndocker:\n  image: x\n  token: claude.work\n",
			want: func(t *testing.T, w *Worker) {
				if w.Docker.Token != "claude.work" {
					t.Errorf("token = %q", w.Docker.Token)
				}
			},
		},
		{
			name:    "docker bad cwd rejected",
			yaml:    "name: bad\ndocker:\n  image: x\n  cwd: /nonexistent/path/abc\n",
			wantErr: true,
		},
		{
			name: "docker disposable accepted",
			yaml: "name: ok\ndocker:\n  image: x\n  lifecycle: disposable\n",
			want: func(t *testing.T, w *Worker) {
				if w.Docker.Lifecycle != "disposable" {
					t.Errorf("lifecycle = %q", w.Docker.Lifecycle)
				}
			},
		},
		{
			name:    "negative timeout",
			yaml:    "name: bad\nendpoint: http://x\ntimeout: -1s\n",
			wantErr: true,
		},
		{
			name:    "negative cpu",
			yaml:    "name: bad\ndocker:\n  image: x\n  resources:\n    cpu: -1\n",
			wantErr: true,
		},
		{
			name:    "negative pids",
			yaml:    "name: bad\ndocker:\n  image: x\n  resources:\n    pids: -1\n",
			wantErr: true,
		},
		{
			name:    "bad memory format",
			yaml:    "name: bad\ndocker:\n  image: x\n  resources:\n    memory: abc\n",
			wantErr: true,
		},
		{
			name:    "unknown lifecycle",
			yaml:    "name: bad\ndocker:\n  image: x\n  lifecycle: ephemeral\n",
			wantErr: true,
		},
		{
			name:    "docker missing image",
			yaml:    "name: broken\ndocker:\n  lifecycle: persistent\n",
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

func TestUnresolvedEnvVarFails(t *testing.T) {
	yaml := "name: envtest\nendpoint: ${NONEXISTENT_VAR_12345}\n"
	path := filepath.Join(t.TempDir(), "worker.yml")
	if err := os.WriteFile(path, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := LoadFile(path)
	if err == nil {
		t.Error("expected error for unresolved env var")
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

func TestDockerHostInterpolation(t *testing.T) {
	t.Setenv("TEST_DOCKER_HOST", "tcp://remote:2375")
	yaml := "name: test\ndocker:\n  image: x\n  host: ${TEST_DOCKER_HOST}\n"
	path := filepath.Join(t.TempDir(), "w.yml")
	os.WriteFile(path, []byte(yaml), 0o644)
	w, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if w.Docker.Host != "tcp://remote:2375" {
		t.Errorf("host = %q", w.Docker.Host)
	}
}

func TestDockerHostUnresolved(t *testing.T) {
	yaml := "name: test\ndocker:\n  image: x\n  host: ${NONEXISTENT_HOST_VAR_XYZ}\n"
	path := filepath.Join(t.TempDir(), "w.yml")
	os.WriteFile(path, []byte(yaml), 0o644)
	_, err := LoadFile(path)
	if err == nil {
		t.Error("expected error for unresolved docker.host var")
	}
}

func TestLoadDirEmpty(t *testing.T) {
	dir := t.TempDir()
	workers, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(workers) != 0 {
		t.Errorf("got %d workers from empty dir", len(workers))
	}
}

func TestLoadDirBadFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "bad.yml"), []byte("invalid: yaml: ["), 0o644)
	_, err := LoadDir(dir)
	if err == nil {
		t.Error("expected error for invalid YAML")
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

func TestValidWorkerName(t *testing.T) {
	valid := []string{
		"alpha", "my-worker", "worker.v2", "test_1",
		"A", "123", "a.b-c_d", "x",
	}
	for _, name := range valid {
		t.Run("valid_"+name, func(t *testing.T) {
			if !validName.MatchString(name) {
				t.Errorf("name %q should be valid", name)
			}
		})
	}

	invalid := []string{
		"", "-dash-start", ".dot-start", "_under-start",
		"has space", "has/slash", "has:colon", "has@at",
		"../traversal", "emoji😀",
	}
	for _, name := range invalid {
		label := name
		if label == "" {
			label = "empty"
		}
		t.Run("invalid_"+label, func(t *testing.T) {
			if validName.MatchString(name) {
				t.Errorf("name %q should be invalid", name)
			}
		})
	}
}
