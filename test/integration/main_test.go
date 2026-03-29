package integration

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

var binaryPath string

func TestMain(m *testing.M) {
	tmp, err := os.MkdirTemp("", "mecha-test-bin-*")
	if err != nil {
		panic(err)
	}
	binaryPath = filepath.Join(tmp, "mecha")
	cmd := exec.Command("go", "build", "-o", binaryPath, "../../cmd/mecha")
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		panic("build failed: " + err.Error())
	}
	code := m.Run()
	os.RemoveAll(tmp)
	os.Exit(code)
}

func runMecha(t *testing.T, regPath string, args ...string) (string, string, int) {
	t.Helper()
	cmd := exec.Command(binaryPath, args...)
	cmd.Env = append(os.Environ(), "MECHA_REGISTRY_PATH="+regPath)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			t.Fatalf("exec error: %v", err)
		}
	}
	return stdout.String(), stderr.String(), exitCode
}

func tempRegistry(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "registry.json")
}

func fixtureDir() string {
	return "testdata"
}

func fixturePath(name string) string {
	return filepath.Join(fixtureDir(), name)
}
