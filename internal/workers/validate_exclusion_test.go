package workers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCredentialsTokenMutualExclusion(t *testing.T) {
	tests := []struct {
		name    string
		yml     string
		wantErr string
	}{
		{
			name:    "credentials only",
			yml:     "name: ok\ndocker:\n  image: x\n  credentials: [claude]\n",
			wantErr: "",
		},
		{
			name:    "token only",
			yml:     "name: ok\ndocker:\n  image: x\n  token: claude.default\n",
			wantErr: "",
		},
		{
			name:    "both rejected",
			yml:     "name: bad\ndocker:\n  image: x\n  credentials: [claude]\n  token: claude.default\n",
			wantErr: "mutually exclusive",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "w.yml")
			os.WriteFile(path, []byte(tt.yml), 0o644)
			_, err := LoadFile(path)
			if tt.wantErr == "" {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
			} else {
				if err == nil {
					t.Error("expected error")
				} else if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("error = %q, want containing %q", err, tt.wantErr)
				}
			}
		})
	}
}

func TestExposeRequiresAPIKey(t *testing.T) {
	tests := []struct {
		name    string
		yml     string
		wantErr bool
	}{
		{
			name:    "expose with key",
			yml:     "name: ok\ndocker:\n  image: x\n  expose: true\n  api_key: secret\n",
			wantErr: false,
		},
		{
			name:    "expose without key",
			yml:     "name: bad\ndocker:\n  image: x\n  expose: true\n",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "w.yml")
			os.WriteFile(path, []byte(tt.yml), 0o644)
			_, err := LoadFile(path)
			if tt.wantErr && err == nil {
				t.Error("expected error")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
