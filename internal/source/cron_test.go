package source

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"mecha.im/internal/events"
)

func TestCronTrigger(t *testing.T) {
	cron := NewCronTrigger("test-cron", 50*time.Millisecond, "daily-check")
	if cron.Name() != "test-cron" {
		t.Fatalf("Name() = %q", cron.Name())
	}

	var count atomic.Int32
	evCh := make(chan *events.Event, 10)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	go cron.Start(ctx, func(ev *events.Event) {
		count.Add(1)
		select {
		case evCh <- ev:
		default:
		}
	})

	<-ctx.Done()
	time.Sleep(10 * time.Millisecond) // let last tick process

	n := count.Load()
	if n < 2 {
		t.Fatalf("expected at least 2 ticks, got %d", n)
	}

	// Read one event safely from channel
	select {
	case ev := <-evCh:
		if ev.Source != "cron" {
			t.Errorf("Source = %q", ev.Source)
		}
		if ev.Type != "tick" {
			t.Errorf("Type = %q", ev.Type)
		}
		if ev.Subject != "daily-check" {
			t.Errorf("Subject = %q", ev.Subject)
		}
		if ev.DedupKey == "" {
			t.Error("DedupKey should be set")
		}
	default:
		t.Fatal("no events received")
	}
}
