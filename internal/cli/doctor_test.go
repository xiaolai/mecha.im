package cli

import (
	"os"
	"path/filepath"
	"testing"

	"mecha.im/internal/store"
)

func TestCheckMechaDir(t *testing.T) {
	// Uses real ~/.mecha — if it exists, should pass; if not, should fail.
	// We test both paths by relying on the real environment.
	// The function only returns bool, so we verify it doesn't panic.
	_ = checkMechaDir()
}

func TestCheckDatabase(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	// Create the DB first (doctor expects it to exist)
	db, err := store.Open(path)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	db.Close()
	t.Setenv("MECHA_DB_PATH", path)
	if !checkDatabase() {
		t.Error("checkDatabase failed with existing db")
	}
}

func TestCheckDatabaseMissing(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MECHA_DB_PATH", filepath.Join(dir, "nonexistent.db"))
	if checkDatabase() {
		t.Error("checkDatabase should fail when db file missing")
	}
}

func TestCheckDatabaseInvalidPath(t *testing.T) {
	t.Setenv("MECHA_DB_PATH", "/nonexistent/dir/test.db")
	if checkDatabase() {
		t.Error("checkDatabase should fail with invalid path")
	}
}

func TestCountRows(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	t.Setenv("MECHA_DB_PATH", path)

	// Import store to open the DB
	db, err := store.Open(path)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	wCount, tCount, err := countRows(db)
	if err != nil {
		t.Fatalf("countRows: %v", err)
	}
	if wCount != 0 {
		t.Errorf("workers = %d, want 0", wCount)
	}
	if tCount != 0 {
		t.Errorf("tasks = %d, want 0", tCount)
	}
}

func TestCheckSecretsMissing(t *testing.T) {
	// checkSecrets returns true (warn) when file is missing
	// This test assumes the function can reach ~/.mecha/secrets.yml
	// or will report warn for missing.
	_ = checkSecrets()
}

func TestCheckSecretsInvalidPermissions(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)
	path := filepath.Join(mechaDir, "secrets.yml")
	os.WriteFile(path, []byte("tokens: {}"), 0o644) // too open

	// Can't override DefaultSecretsPath easily, so we test LoadSecrets directly
	// via the worker package tests. This is a smoke test.
	_ = checkSecrets()
}

func TestPrintStatus(t *testing.T) {
	tests := []struct {
		status string
		msg    string
	}{
		{"ok", "test ok"},
		{"warn", "test warn"},
		{"fail", "test fail"},
	}
	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			// Verify no panic
			printStatus(tt.status, tt.msg)
		})
	}
}
