package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeCmdFlags(t *testing.T) {
	cmd := serveCmd()
	if cmd.Use != "serve" {
		t.Errorf("use = %q, want serve", cmd.Use)
	}
	f := cmd.Flags()
	if f.Lookup("addr") == nil {
		t.Error("missing --addr flag")
	}
	if f.Lookup("api-key") == nil {
		t.Error("missing --api-key flag")
	}
	// Verify defaults
	addr, _ := f.GetString("addr")
	if addr != "127.0.0.1:8080" {
		t.Errorf("default addr = %q, want 127.0.0.1:8080", addr)
	}
}

func TestServeCmdBadDBPath(t *testing.T) {
	t.Setenv("MECHA_DB_PATH", "/nonexistent/impossible/path/test.db")
	cmd := serveCmd()
	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for bad DB path")
	}
	if !strings.Contains(err.Error(), "database") && !strings.Contains(err.Error(), "db") {
		t.Errorf("error = %q, want mention of database", err)
	}
}

func TestServeCmdBadSecretsPermissions(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	secretsPath := filepath.Join(mechaDir, "secrets.yml")
	os.WriteFile(secretsPath, []byte("tokens: {}"), 0o644) // too open

	dbPath := filepath.Join(mechaDir, "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)
	t.Setenv("HOME", dir)

	cmd := serveCmd()
	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for bad secrets permissions")
	}
	if !strings.Contains(err.Error(), "permissions") && !strings.Contains(err.Error(), "0644") {
		t.Errorf("error = %q, want mention of permissions", err)
	}
}

func TestServeCmdGitHubMissingWebhookSecret(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	// github.token set but no webhook_secret → should fail
	secretsPath := filepath.Join(mechaDir, "secrets.yml")
	os.WriteFile(secretsPath, []byte("github:\n  token: ghp_test123\n"), 0o600)

	dbPath := filepath.Join(mechaDir, "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)
	t.Setenv("HOME", dir)

	cmd := serveCmd()
	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for missing webhook_secret")
	}
	if !strings.Contains(err.Error(), "webhook_secret") {
		t.Errorf("error = %q, want mention of webhook_secret", err)
	}
}

func TestServeCmdNoSecrets(t *testing.T) {
	// No secrets file at all — should reach server start (bind error on bad addr)
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)

	dbPath := filepath.Join(mechaDir, "test.db")
	t.Setenv("MECHA_DB_PATH", dbPath)
	t.Setenv("HOME", dir)

	cmd := serveCmd()
	// Use an invalid addr to make it fail fast at Listen, not hang
	cmd.Flags().Set("addr", "invalid-addr-!@#$%")
	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for bad listen address")
	}
}
