package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// Open creates or opens a SQLite database with versioned migrations.
func Open(path string) (*sql.DB, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	// Restrict DB file permissions — contains worker definitions with env vars.
	os.Chmod(path, 0o600)
	db.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=OFF",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("exec %s: %w", pragma, err)
		}
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

// DefaultDBPath returns ~/.mecha/mecha.db.
func DefaultDBPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	return filepath.Join(home, ".mecha", "mecha.db"), nil
}

func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}
	type migration struct {
		version int
		stmts   []string
	}
	migrations := []migration{
		{1, splitStatements(schemaV1)},
		{2, splitStatements(schemaV2)},
		{3, splitStatements(schemaV3)},
		{4, splitStatements(schemaV4)},
		{5, splitStatements(schemaV5)},
		{6, splitStatements(schemaV6)},
		{7, splitStatements(schemaV7)},
	}
	for _, m := range migrations {
		if version >= m.version {
			continue
		}
		if err := applyMigration(db, m.version, m.stmts); err != nil {
			return err
		}
	}
	return nil
}

// applyMigration runs all statements in a single transaction and sets user_version.
// If the transaction fails, all changes are rolled back atomically.
func applyMigration(db *sql.DB, ver int, stmts []string) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin v%d migration: %w", ver, err)
	}
	defer tx.Rollback()
	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			if strings.Contains(err.Error(), "duplicate column") {
				continue
			}
			return fmt.Errorf("apply schema v%d: %w", ver, err)
		}
	}
	if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", ver)); err != nil {
		return fmt.Errorf("set user_version %d: %w", ver, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit v%d migration: %w", ver, err)
	}
	return nil
}

// splitStatements splits a multi-statement SQL string on semicolons.
func splitStatements(sql string) []string {
	var stmts []string
	for _, s := range strings.Split(sql, ";") {
		s = strings.TrimSpace(s)
		if s != "" {
			stmts = append(stmts, s)
		}
	}
	return stmts
}
