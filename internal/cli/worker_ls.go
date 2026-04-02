package cli

import (
	"fmt"
	"os"
	"sync"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"mecha.im/internal/workers"
)

func workerLsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "ls",
		Short: "List all workers",
		RunE: func(cmd *cobra.Command, args []string) error {
			reg := registry()
			entries := reg.List()
			if len(entries) == 0 {
				fmt.Println("no workers registered")
				return nil
			}
			probeResults := probeHealthConcurrent(entries)
			tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(tw, "NAME\tTYPE\tSTATE\tENDPOINT\tHEALTH")
			for i, e := range entries {
				endpoint := "-"
				if e.RuntimeEndpoint != "" {
					endpoint = e.RuntimeEndpoint
				} else if e.Worker.Endpoint != "" {
					endpoint = e.Worker.Endpoint
				}
				health := probeResults[i]
				if health == "unreachable" && e.State == workers.StateOnline {
					if setErr := reg.SetError(e.Worker.Name, "health check failed"); setErr != nil {
						fmt.Fprintf(os.Stderr, "warning: failed to set error state for %s: %v\n", e.Worker.Name, setErr)
					}
				}
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n",
					e.Worker.Name,
					e.Worker.TypeLabel(),
					e.State,
					endpoint,
					health,
				)
			}
			return tw.Flush()
		},
	}
}

func probeHealthConcurrent(entries []workers.Entry) []string {
	results := make([]string, len(entries))
	var wg sync.WaitGroup
	for i, e := range entries {
		ep := e.RuntimeEndpoint
		if ep == "" {
			ep = e.Worker.Endpoint
		}
		if e.State == workers.StateOffline || ep == "" {
			results[i] = "-"
			continue
		}
		if e.State == workers.StateError {
			results[i] = workers.RedactSecrets(e.Error)
			continue
		}
		wg.Add(1)
		go func(idx int, endpoint string) {
			defer wg.Done()
			if err := workers.CheckHealth(endpoint, 5*time.Second); err != nil {
				results[idx] = "unreachable"
			} else {
				results[idx] = "ok"
			}
		}(i, ep)
	}
	wg.Wait()
	return results
}
