package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// --- migrate: exercise V2→V5 migration paths step by step ---

func TestMigrateFromV1(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v1.db")
	// Create a raw DB and set up only V1 schema
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(schemaV1); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("PRAGMA user_version = 1"); err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Now open via Open() which should run V2→V5 migrations
	db2, err := Open(path)
	if err != nil {
		t.Fatalf("Open after V1: %v", err)
	}
	defer db2.Close()

	var version int
	if err := db2.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 6 {
		t.Errorf("version = %d, want 6", version)
	}
}

func TestMigrateFromV2(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v2.db")
	// Create DB with V1 + V2 schema manually
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		t.Fatal(err)
	}
	// Apply V1 schema
	if _, err := db.Exec(schemaV1); err != nil {
		t.Fatal(err)
	}
	// Apply V2 schema (adds event_id, context columns to tasks + creates events table)
	for _, stmt := range splitStatements(schemaV2) {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("apply V2: %v", err)
		}
	}
	if _, err := db.Exec("PRAGMA user_version = 2"); err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Open should run V3→V5 migrations
	db2, err := Open(path)
	if err != nil {
		t.Fatalf("Open after V2: %v", err)
	}
	defer db2.Close()

	var version int
	if err := db2.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 6 {
		t.Errorf("version = %d, want 6", version)
	}
}

func TestMigrateFromV3(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v3.db")
	// First create a fully migrated DB
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Set version back to 3 to test V4→V5 migrations
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA user_version = 3"); err != nil {
		t.Fatal(err)
	}
	db.Close()

	db2, err := Open(path)
	if err != nil {
		t.Fatalf("Open after V3: %v", err)
	}
	defer db2.Close()

	var version int
	if err := db2.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 6 {
		t.Errorf("version = %d, want 6", version)
	}
}

func TestMigrateFromV4(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v4.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Set version back to 4 to test V5 migration
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA user_version = 4"); err != nil {
		t.Fatal(err)
	}
	db.Close()

	db2, err := Open(path)
	if err != nil {
		t.Fatalf("Open after V4: %v", err)
	}
	defer db2.Close()

	var version int
	if err := db2.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 6 {
		t.Errorf("version = %d, want 6", version)
	}
}

// --- Open: closed DB for pragma failures ---

func TestMigrateQueryClosedDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "closed.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	db.Close()

	err = migrate(db)
	if err == nil {
		t.Error("expected error when querying closed DB")
	}
}

// --- Open: read-only DB for migration failures ---

func TestMigrateReadOnlyDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "readonly.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		t.Fatal(err)
	}
	// Set to query_only mode — writes will fail
	if _, err := db.Exec("PRAGMA query_only = ON"); err != nil {
		t.Fatal(err)
	}

	err = migrate(db)
	if err == nil {
		t.Error("expected error when migrating read-only DB")
	}
	db.Close()
}

// --- DefaultDBPath returns correct suffix ---

func TestDefaultDBPathFormat(t *testing.T) {
	path, err := DefaultDBPath()
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(path) {
		t.Errorf("expected absolute path, got %q", path)
	}
	dir := filepath.Dir(path)
	base := filepath.Base(dir)
	if base != ".mecha" {
		t.Errorf("parent dir = %q, want .mecha", base)
	}
	if filepath.Base(path) != "mecha.db" {
		t.Errorf("filename = %q, want mecha.db", filepath.Base(path))
	}
}

// --- V2 migration: duplicate column (idempotent re-run of ALTER TABLE) ---

func TestMigrateV2DuplicateColumn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v2dup.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		t.Fatal(err)
	}
	// Apply V1 schema
	if _, err := db.Exec(schemaV1); err != nil {
		t.Fatal(err)
	}
	// Manually add the event_id column (part of V2) to simulate partial V2
	if _, err := db.Exec("ALTER TABLE tasks ADD COLUMN event_id TEXT"); err != nil {
		t.Fatal(err)
	}
	// Set version to 1 so migrate will try V2 again (hitting duplicate column)
	if _, err := db.Exec("PRAGMA user_version = 1"); err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Open should handle the duplicate column error gracefully
	db2, err := Open(path)
	if err != nil {
		t.Fatalf("Open with duplicate column: %v", err)
	}
	defer db2.Close()

	var version int
	if err := db2.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 6 {
		t.Errorf("version = %d, want 6", version)
	}
}

// --- V4 migration: duplicate column ---

func TestMigrateV4DuplicateColumn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v4dup.db")
	// Create a fully migrated DB
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Set version back to 3 so V4+V5 will be re-applied
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA user_version = 3"); err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Open should handle duplicate column in V4 gracefully
	db2, err := Open(path)
	if err != nil {
		t.Fatalf("Open with V4 dup: %v", err)
	}
	defer db2.Close()

	var version int
	if err := db2.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 6 {
		t.Errorf("version = %d, want 6", version)
	}
}

// --- V5 migration: duplicate column ---

func TestMigrateV5DuplicateColumn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v5dup.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Set version back to 4 so V5 will re-run (columns already exist)
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA user_version = 4"); err != nil {
		t.Fatal(err)
	}
	db.Close()

	db2, err := Open(path)
	if err != nil {
		t.Fatalf("Open with V5 dup: %v", err)
	}
	defer db2.Close()

	var version int
	if err := db2.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 6 {
		t.Errorf("version = %d, want 6", version)
	}
}

// --- Open: already-existing DB with data ---

func TestOpenExistingDBWithData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing.db")
	db1, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	// Insert some data
	_, err = db1.Exec(`INSERT INTO workers (name, definition, state, error_msg, container_id, endpoint)
		VALUES ('w1', '{}', 'offline', '', '', '')`)
	if err != nil {
		t.Fatal(err)
	}
	db1.Close()

	// Re-open — should work with existing data
	db2, err := Open(path)
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	defer db2.Close()

	var count int
	if err := db2.QueryRow("SELECT COUNT(*) FROM workers").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("count = %d, want 1", count)
	}
}
