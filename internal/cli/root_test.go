package cli

import (
	"bytes"
	"os"
	"testing"
)

// captureStdout redirects os.Stdout during fn and returns what was written.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	old := os.Stdout
	os.Stdout = w
	defer func() { os.Stdout = old }()

	fn()
	w.Close()

	var buf bytes.Buffer
	buf.ReadFrom(r)
	return buf.String()
}

func TestVersionCmd(t *testing.T) {
	saved := Version
	Version = "v1.2.3-test"
	defer func() { Version = saved }()

	cmd := versionCmd()
	got := captureStdout(t, func() {
		cmd.Run(cmd, []string{})
	})
	want := "mecha v1.2.3-test\n"
	if got != want {
		t.Errorf("version output = %q, want %q", got, want)
	}
}

func TestVersionCmdDefault(t *testing.T) {
	saved := Version
	Version = "dev"
	defer func() { Version = saved }()

	cmd := versionCmd()
	got := captureStdout(t, func() {
		cmd.Run(cmd, []string{})
	})
	want := "mecha dev\n"
	if got != want {
		t.Errorf("version output = %q, want %q", got, want)
	}
}
