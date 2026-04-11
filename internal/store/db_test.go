package store

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenCreatesDB(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Verify tables exist
	for _, table := range []string{"workers", "tasks"} {
		var name string
		err := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&name)
		if err != nil {
			t.Errorf("table %q not found: %v", table, err)
		}
	}
}

func TestOpenIdempotent(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "test.db")
	db1, err := Open(path)
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}
	db1.Close()

	db2, err := Open(path)
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	defer db2.Close()
}

func TestDefaultDBPath(t *testing.T) {
	t.Parallel()
	path, err := DefaultDBPath()
	if err != nil {
		t.Fatal(err)
	}
	if path == "" {
		t.Error("expected non-empty path")
	}
	if !strings.Contains(path, "mecha.db") {
		t.Errorf("path = %q, want containing mecha.db", path)
	}
}

func TestOpenBadPath(t *testing.T) {
	t.Parallel()
	_, err := Open("/dev/null/impossible/path.db")
	if err == nil {
		t.Error("expected error for bad path")
	}
}

func TestOpenWALMode(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var mode string
	if err := db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Errorf("journal_mode = %q, want wal", mode)
	}
}
