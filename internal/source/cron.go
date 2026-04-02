package source

import (
	"context"
	"fmt"
	"hash/fnv"
	"time"

	"mecha.im/internal/events"
)

// CronTrigger generates events on a fixed schedule.
type CronTrigger struct {
	name     string
	interval time.Duration
	subject  string
}

// NewCronTrigger creates a trigger that fires every interval.
func NewCronTrigger(name string, interval time.Duration, subject string) *CronTrigger {
	return &CronTrigger{name: name, interval: interval, subject: subject}
}

// Name returns the trigger name.
func (c *CronTrigger) Name() string { return c.name }

// Start runs the cron loop, emitting events until ctx is cancelled.
func (c *CronTrigger) Start(ctx context.Context, emit func(*events.Event)) error {
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case t := <-ticker.C:
			ev := &events.Event{
				Source:  "cron",
				Type:    "tick",
				Actor:   c.name,
				Subject: c.subject,
				Attrs:   events.Attrs{"tick_time": t.Format(time.RFC3339)},
			}
			// Dedup key prevents duplicate processing if emit is slow
			h := fnv.New64a()
			fmt.Fprintf(h, "%s:%s:%d", c.name, c.subject, t.Unix())
			ev.DedupKey = fmt.Sprintf("%016x", h.Sum64())
			emit(ev)
		}
	}
}
