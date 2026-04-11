package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mecha.im/internal/workers"
)

func TestBuildContainerEnv(t *testing.T) {
	tests := []struct {
		name    string
		dc      *workers.DockerConfig
		wantErr string
		check   func(*testing.T, map[string]string)
	}{
		{
			name: "clean env passthrough",
			dc:   &workers.DockerConfig{Env: map[string]string{"FOO": "bar", "BAZ": "123"}},
			check: func(t *testing.T, env map[string]string) {
				if env["FOO"] != "bar" {
					t.Errorf("FOO = %q", env["FOO"])
				}
			},
		},
		{
			name: "HOME always set",
			dc:   &workers.DockerConfig{Env: map[string]string{}},
			check: func(t *testing.T, env map[string]string) {
				if env["HOME"] != "/tmp" {
					t.Errorf("HOME = %q, want /tmp", env["HOME"])
				}
			},
		},
		{
			name: "GITHUB_TOKEN allowed",
			dc:   &workers.DockerConfig{Env: map[string]string{"GITHUB_TOKEN": "ghp_xxx"}},
			check: func(t *testing.T, env map[string]string) {
				if env["GITHUB_TOKEN"] != "ghp_xxx" {
					t.Errorf("GITHUB_TOKEN = %q", env["GITHUB_TOKEN"])
				}
			},
		},
		{
			name:    "reserved WORKER_PORT blocked",
			dc:      &workers.DockerConfig{Env: map[string]string{"WORKER_PORT": "9999"}},
			wantErr: "reserved",
		},
		{
			name:    "reserved HOME blocked",
			dc:      &workers.DockerConfig{Env: map[string]string{"HOME": "/root"}},
			wantErr: "reserved",
		},
		{
			name:    "token ref with no matching token",
			dc:      &workers.DockerConfig{Token: "claude.nonexistent"},
			wantErr: "resolve token",
		},
		{
			name: "empty token skips resolution",
			dc:   &workers.DockerConfig{Token: "", Env: map[string]string{"X": "1"}},
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
		dc := &workers.DockerConfig{}
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
		dc := &workers.DockerConfig{Cwd: dir}
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
	})

	t.Run("symlink resolved", func(t *testing.T) {
		dir := t.TempDir()
		link := filepath.Join(t.TempDir(), "link")
		if err := os.Symlink(dir, link); err != nil {
			t.Skip("symlinks not supported")
		}
		dc := &workers.DockerConfig{Cwd: link}
		mounts, err := buildContainerMounts(dc)
		if err != nil {
			t.Fatalf("error: %v", err)
		}
		if mounts[0].Source == link {
			t.Errorf("source should be resolved, got symlink path %q", link)
		}
	})

	t.Run("nonexistent path", func(t *testing.T) {
		dc := &workers.DockerConfig{Cwd: "/nonexistent/path/abc"}
		_, err := buildContainerMounts(dc)
		if err == nil {
			t.Error("expected error for nonexistent path")
		}
	})

	t.Run("file not directory", func(t *testing.T) {
		f := filepath.Join(t.TempDir(), "file.txt")
		os.WriteFile(f, []byte("x"), 0o644)
		dc := &workers.DockerConfig{Cwd: f}
		_, err := buildContainerMounts(dc)
		if err == nil || !strings.Contains(err.Error(), "not a directory") {
			t.Errorf("error = %v", err)
		}
	})
}
