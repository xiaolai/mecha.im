package cli

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"mecha.im/internal/store"
	"mecha.im/internal/worker"
)

const doctorTimeout = 60 * time.Second

func doctorCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "doctor",
		Short: "Check system health and configuration",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, cancel := context.WithTimeout(cmd.Context(), doctorTimeout)
			defer cancel()
			ok := true
			ok = runSystemChecks(ctx) && ok
			ok = runWorkerChecks(ctx) && ok
			fmt.Println()
			if !ok {
				return fmt.Errorf("some checks failed")
			}
			printStatus("ok", "all checks passed")
			return nil
		},
	}
}

func runSystemChecks(ctx context.Context) bool {
	fmt.Println("\nSystem")
	ok := true
	ok = checkMechaDir() && ok
	ok = checkDatabase() && ok
	ok = checkSecrets() && ok
	ok = checkDocker(ctx) && ok
	return ok
}

func checkMechaDir() bool {
	home, err := os.UserHomeDir()
	if err != nil {
		printStatus("fail", "cannot resolve home directory: "+err.Error())
		return false
	}
	dir := home + "/.mecha"
	info, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			printStatus("fail", "~/.mecha/ does not exist")
		} else {
			printStatus("fail", "~/.mecha/: "+err.Error())
		}
		return false
	}
	if !info.IsDir() {
		printStatus("fail", "~/.mecha exists but is not a directory")
		return false
	}
	printStatus("ok", "~/.mecha/ exists")
	return true
}

func checkDatabase() bool {
	path := os.Getenv("MECHA_DB_PATH")
	if path == "" {
		var err error
		path, err = store.DefaultDBPath()
		if err != nil {
			printStatus("fail", "cannot resolve database path: "+err.Error())
			return false
		}
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		printStatus("fail", "database not found: "+path)
		return false
	}
	db, err := store.Open(path)
	if err != nil {
		printStatus("fail", "database: "+err.Error())
		return false
	}
	defer db.Close()
	workers, tasks, err := countRows(db)
	if err != nil {
		printStatus("fail", "database schema broken: "+err.Error())
		return false
	}
	printStatus("ok", fmt.Sprintf("database opens (%d workers, %d tasks)", workers, tasks))
	return true
}

func countRows(db *sql.DB) (int, int, error) {
	var workers, tasks int
	if err := db.QueryRow("SELECT COUNT(*) FROM workers").Scan(&workers); err != nil {
		return 0, 0, fmt.Errorf("count workers: %w", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM tasks").Scan(&tasks); err != nil {
		return 0, 0, fmt.Errorf("count tasks: %w", err)
	}
	return workers, tasks, nil
}

func checkSecrets() bool {
	path, err := worker.DefaultSecretsPath()
	if err != nil {
		printStatus("fail", "cannot resolve secrets path: "+err.Error())
		return false
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		printStatus("warn", "~/.mecha/secrets.yml not found (optional)")
		return true
	}
	secrets, err := worker.LoadSecrets(path)
	if err != nil {
		printStatus("fail", "secrets: "+err.Error())
		return false
	}
	groups := len(secrets.Tokens)
	printStatus("ok", fmt.Sprintf("secrets file valid (%d token groups)", groups))
	return true
}

func checkDocker(ctx context.Context) bool {
	dc, err := worker.NewDockerClient("")
	if err != nil {
		printStatus("fail", "docker client: "+err.Error())
		return false
	}
	defer dc.Close()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	apiVer, err := dc.Ping(ctx)
	if err != nil {
		printStatus("fail", "docker daemon unreachable: "+err.Error())
		return false
	}
	printStatus("ok", fmt.Sprintf("docker daemon reachable (API %s)", apiVer))
	return true
}

func printStatus(status, msg string) {
	msg = worker.RedactSecrets(msg)
	var prefix string
	switch status {
	case "ok":
		prefix = "  [ok]  "
	case "warn":
		prefix = "  [!!]  "
	case "fail":
		prefix = "  [FAIL]"
	default:
		prefix = "  [??]  "
	}
	fmt.Printf("%s %s\n", prefix, msg)
}
