package workers

import (
	"context"
	"fmt"
	"time"

	"github.com/moby/moby/client"
)

// CleanupOrphanDisposables removes containers labeled mecha.lifecycle=disposable
// that were left behind by a previous crash. Should be called on startup before
// the dispatch loop begins.
func (d *DockerClient) CleanupOrphanDisposables(ctx context.Context) (int, error) {
	filters := make(client.Filters).
		Add("label", "mecha.lifecycle=disposable")

	result, err := d.cli.ContainerList(ctx, client.ContainerListOptions{
		All:     true,
		Filters: filters,
	})
	if err != nil {
		return 0, fmt.Errorf("list orphan disposables: %w", err)
	}

	removed := 0
	for _, c := range result.Items {
		stopCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		_ = d.Stop(stopCtx, c.ID, 5*time.Second)
		cancel()

		if rmErr := d.Remove(ctx, c.ID); rmErr != nil {
			// Log but continue — best effort cleanup
			continue
		}
		removed++
	}
	return removed, nil
}
