package store

import (
	"path/filepath"
	"strings"
	"testing"
)

// --- 1. Open — valid path (covered), non-writable directory ---

func TestOpenNonWritableDirectory(t *testing.T) {
	t.Parallel()
	// /dev/null/anything is not a valid directory on any OS
	_, err := Open("/dev/null/subdir/test.db")
	if err == nil {
		t.Error("expected error for non-writable directory")
	}
}

// --- 2. migrate — idempotent re-run ---

func TestMigrateIdempotent(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "test.db")

	// First open creates and migrates
	db1, err := Open(path)
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}

	// Verify schema version
	var version int
	if err := db1.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version == 0 {
		t.Error("expected non-zero schema version after migration")
	}
	db1.Close()

	// Second open should re-run migrations idempotently
	db2, err := Open(path)
	if err != nil {
		t.Fatalf("second Open (idempotent migration): %v", err)
	}
	defer db2.Close()

	var version2 int
	if err := db2.QueryRow("PRAGMA user_version").Scan(&version2); err != nil {
		t.Fatal(err)
	}
	if version2 != version {
		t.Errorf("version after re-migration = %d, want %d", version2, version)
	}

	// Verify tables still exist and are usable
	for _, table := range []string{"workers", "tasks", "events"} {
		var name string
		err := db2.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&name)
		if err != nil {
			t.Errorf("table %q not found after re-migration: %v", table, err)
		}
	}
}

// --- 3. DefaultDBPath ---

func TestDefaultDBPathEndsCorrectly(t *testing.T) {
	t.Parallel()
	path, err := DefaultDBPath()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(path, filepath.Join(".mecha", "mecha.db")) {
		t.Errorf("path = %q, want suffix .mecha/mecha.db", path)
	}
}

// --- Additional: Verify all schema versions are applied ---

func TestAllSchemaVersionsApplied(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	// Should be at least v5 (latest migration)
	if version < 5 {
		t.Errorf("schema version = %d, want >= 5", version)
	}
}

// --- Additional: Verify events table columns after migration ---

func TestEventsTableHasExpectedColumns(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// Test insert + select to verify column structure
	_, err = db.Exec(`INSERT INTO events (id, delivery_id, dedup_key, source, type,
		actor, subject, attrs, raw, state, worker_name, task_id, created_at, updated_at)
		VALUES ('test-id', 'del-1', '', 'test', 'test.event', 'actor', 'subject',
		'{}', '', 'received', '', '', 1000, 1000)`)
	if err != nil {
		t.Fatalf("insert into events: %v", err)
	}

	var id, source string
	err = db.QueryRow("SELECT id, source FROM events WHERE id = 'test-id'").Scan(&id, &source)
	if err != nil {
		t.Fatalf("select from events: %v", err)
	}
	if id != "test-id" || source != "test" {
		t.Errorf("got id=%q source=%q", id, source)
	}
}

// --- Additional: Tasks table has retry columns from v5 ---

func TestTasksTableHasRetryColumns(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`INSERT INTO tasks (id, worker_name, prompt, state, created_at, updated_at, attempts, max_retries)
		VALUES ('task-1', 'worker', 'prompt', 'pending', 1000, 1000, 0, 3)`)
	if err != nil {
		t.Fatalf("insert with retry columns: %v", err)
	}
}

// --- Additional: WAL mode preserved after re-open ---

func TestWALModePreserved(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	db2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()

	var mode string
	if err := db2.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Errorf("journal_mode = %q, want wal", mode)
	}
}
