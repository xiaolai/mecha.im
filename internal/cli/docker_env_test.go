package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mecha.im/internal/worker"
)

func TestBuildContainerEnv(t *testing.T) {
	tests := []struct {
		name    string
		dc      *worker.DockerConfig
		wantErr string
		check   func(*testing.T, map[string]string)
	}{
		{
			name: "clean env passthrough",
			dc:   &worker.DockerConfig{Env: map[string]string{"FOO": "bar", "BAZ": "123"}},
			check: func(t *testing.T, env map[string]string) {
				if env["FOO"] != "bar" {
					t.Errorf("FOO = %q", env["FOO"])
				}
				if env["BAZ"] != "123" {
					t.Errorf("BAZ = %q", env["BAZ"])
				}
			},
		},
		{
			name: "HOME always set",
			dc:   &worker.DockerConfig{Env: map[string]string{}},
			check: func(t *testing.T, env map[string]string) {
				if env["HOME"] != "/tmp" {
					t.Errorf("HOME = %q, want /tmp", env["HOME"])
				}
			},
		},
		{
			name:    "blocked GITHUB_TOKEN",
			dc:      &worker.DockerConfig{Env: map[string]string{"GITHUB_TOKEN": "ghp_xxx"}},
			wantErr: "blocked",
		},
		{
			name:    "blocked GH_TOKEN",
			dc:      &worker.DockerConfig{Env: map[string]string{"GH_TOKEN": "xxx"}},
			wantErr: "blocked",
		},
		{
			name:    "blocked case insensitive",
			dc:      &worker.DockerConfig{Env: map[string]string{"Github_Token": "xxx"}},
			wantErr: "blocked",
		},
		{
			name:    "credential value ghp_",
			dc:      &worker.DockerConfig{Env: map[string]string{"MY_KEY": "ghp_secret123"}},
			wantErr: "credential",
		},
		{
			name:    "credential value ghs_",
			dc:      &worker.DockerConfig{Env: map[string]string{"MY_KEY": "ghs_secret123"}},
			wantErr: "credential",
		},
		{
			name:    "credential value github_pat_",
			dc:      &worker.DockerConfig{Env: map[string]string{"MY_KEY": "github_pat_secret"}},
			wantErr: "credential",
		},
		{
			name:    "token ref with no matching token",
			dc:      &worker.DockerConfig{Token: "claude.nonexistent"},
			wantErr: "not found",
		},
		{
			name: "empty token skips resolution",
			dc:   &worker.DockerConfig{Token: "", Env: map[string]string{"X": "1"}},
			check: func(t *testing.T, env map[string]string) {
				if env["X"] != "1" {
					t.Errorf("X = %q", env["X"])
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env, err := buildContainerEnv(tt.dc)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.wantErr)
				}
				if !strings.Contains(strings.ToLower(err.Error()), tt.wantErr) {
					t.Errorf("error = %q, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.check != nil {
				tt.check(t, env)
			}
		})
	}
}

func TestBuildContainerMounts(t *testing.T) {
	t.Run("empty cwd", func(t *testing.T) {
		dc := &worker.DockerConfig{}
		mounts, err := buildContainerMounts(dc)
		if err != nil {
			t.Fatalf("error: %v", err)
		}
		if len(mounts) != 0 {
			t.Errorf("got %d mounts, want 0", len(mounts))
		}
	})

	t.Run("valid directory", func(t *testing.T) {
		dir := t.TempDir()
		dc := &worker.DockerConfig{Cwd: dir}
		mounts, err := buildContainerMounts(dc)
		if err != nil {
			t.Fatalf("error: %v", err)
		}
		if len(mounts) != 1 {
			t.Fatalf("got %d mounts, want 1", len(mounts))
		}
		if mounts[0].Target != "/workspace" {
			t.Errorf("target = %q", mounts[0].Target)
		}
		if mounts[0].ReadOnly {
			t.Error("mount should be read-write")
		}
	})

	t.Run("symlink resolved", func(t *testing.T) {
		dir := t.TempDir()
		link := filepath.Join(t.TempDir(), "link")
		if err := os.Symlink(dir, link); err != nil {
			t.Skip("symlinks not supported")
		}
		dc := &worker.DockerConfig{Cwd: link}
		mounts, err := buildContainerMounts(dc)
		if err != nil {
			t.Fatalf("error: %v", err)
		}
		if len(mounts) != 1 {
			t.Fatalf("got %d mounts", len(mounts))
		}
		// Source should be the real path, not the symlink
		if mounts[0].Source == link {
			t.Errorf("source should be resolved, got symlink path %q", link)
		}
	})

	t.Run("nonexistent path", func(t *testing.T) {
		dc := &worker.DockerConfig{Cwd: "/nonexistent/path/abc"}
		_, err := buildContainerMounts(dc)
		if err == nil {
			t.Error("expected error for nonexistent path")
		}
	})

	t.Run("file not directory", func(t *testing.T) {
		f := filepath.Join(t.TempDir(), "file.txt")
		if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		dc := &worker.DockerConfig{Cwd: f}
		_, err := buildContainerMounts(dc)
		if err == nil {
			t.Error("expected error for file path")
		}
		if !strings.Contains(err.Error(), "not a directory") {
			t.Errorf("error = %q, want 'not a directory'", err)
		}
	})
}
