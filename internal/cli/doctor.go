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

func doctorCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "doctor",
		Short: "Check system health and configuration",
		RunE: func(cmd *cobra.Command, args []string) error {
			ok := true
			ok = runSystemChecks() && ok
			ok = runWorkerChecks() && ok
			fmt.Println()
			if !ok {
				return fmt.Errorf("some checks failed")
			}
			printStatus("ok", "all checks passed")
			return nil
		},
	}
}

func runSystemChecks() bool {
	fmt.Println("\nSystem")
	ok := true
	ok = checkMechaDir() && ok
	ok = checkDatabase() && ok
	ok = checkSecrets() && ok
	ok = checkDocker() && ok
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
		printStatus("fail", "~/.mecha/ does not exist")
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
	db, err := store.Open(path)
	if err != nil {
		printStatus("fail", "database: "+err.Error())
		return false
	}
	defer db.Close()
	workers, tasks := countRows(db)
	printStatus("ok", fmt.Sprintf("database opens (%d workers, %d tasks)", workers, tasks))
	return true
}

func countRows(db *sql.DB) (int, int) {
	var workers, tasks int
	_ = db.QueryRow("SELECT COUNT(*) FROM workers").Scan(&workers)
	_ = db.QueryRow("SELECT COUNT(*) FROM tasks").Scan(&tasks)
	return workers, tasks
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
		printStatus("fail", "secrets: "+worker.RedactSecrets(err.Error()))
		return false
	}
	groups := len(secrets.Tokens)
	printStatus("ok", fmt.Sprintf("secrets file valid (%d token groups)", groups))
	return true
}

func checkDocker() bool {
	dc, err := worker.NewDockerClient("")
	if err != nil {
		printStatus("fail", "docker client: "+err.Error())
		return false
	}
	defer dc.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
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
	var prefix string
	switch status {
	case "ok":
		prefix = "  [ok]  "
	case "warn":
		prefix = "  [!!]  "
	case "fail":
		prefix = "  [FAIL]"
	}
	fmt.Printf("%s %s\n", prefix, msg)
}
