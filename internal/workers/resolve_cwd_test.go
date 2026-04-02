package workers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveCwdValid(t *testing.T) {
	dir := t.TempDir()
	resolved, err := ResolveCwd(dir)
	if err != nil {
		t.Fatal(err)
	}
	// On macOS, t.TempDir() may use /var which symlinks to /private/var
	// so resolved may differ from dir — just check it's a real directory
	info, err := os.Stat(resolved)
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		t.Errorf("ResolveCwd(%q) = %q, not a directory", dir, resolved)
	}
}

func TestResolveCwdSymlink(t *testing.T) {
	real := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skip("symlinks not supported")
	}
	resolved, err := ResolveCwd(link)
	if err != nil {
		t.Fatal(err)
	}
	if resolved == link {
		t.Error("symlink should be resolved")
	}
}

func TestResolveCwdNonexistent(t *testing.T) {
	_, err := ResolveCwd("/nonexistent/path")
	if err == nil {
		t.Error("expected error for nonexistent path")
	}
}

func TestResolveCwdFile(t *testing.T) {
	f := filepath.Join(t.TempDir(), "file.txt")
	os.WriteFile(f, []byte("x"), 0o644)
	_, err := ResolveCwd(f)
	if err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Errorf("error = %v", err)
	}
}
