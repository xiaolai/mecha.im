package serve

import (
	"expvar"
	"sync"
	"time"
)

// Metrics exposed via expvar at /debug/vars (stdlib, zero dependencies).
var (
	tasksCreated     = expvar.NewInt("tasks_created")
	tasksCompleted   = expvar.NewInt("tasks_completed")
	tasksFailed      = expvar.NewInt("tasks_failed")
	tasksRecovered   = expvar.NewInt("tasks_recovered")
	tasksRetried     = expvar.NewInt("tasks_retried")
	tasksDedupSkip   = expvar.NewInt("tasks_dedup_skipped")
	tasksRateLimited = expvar.NewInt("tasks_rate_limited")
	dispatchLatency  = expvar.NewFloat("dispatch_latency_ms_ema")
	queueDepth       = expvar.NewInt("queue_depth")
	webhooksReceived = expvar.NewInt("webhooks_received")
	writebackOK         = expvar.NewInt("writeback_ok")
	writebackFail       = expvar.NewInt("writeback_fail")
	writebackRetryOK    = expvar.NewInt("writeback_retry_ok")
	writebackDeadLetter = expvar.NewInt("writeback_dead_letter")
	eventsDedupSkip     = expvar.NewInt("events_dedup_skipped")
	cronTicksDropped    = expvar.NewInt("cron_ticks_dropped_total")
)

// latencyTracker computes an exponential moving average (EMA) of dispatch
// latency. EMA gives more weight to recent observations, making spikes
// visible within a few tasks rather than requiring thousands of samples
// to move the needle on a cumulative average.
// α=0.1 weights the most recent 10 tasks heavily.
const emaAlpha = 0.1

type latencyTracker struct {
	mu  sync.Mutex
	ema float64
}

func (lt *latencyTracker) observe(d time.Duration) {
	lt.mu.Lock()
	ms := float64(d.Milliseconds())
	if lt.ema == 0 {
		lt.ema = ms // seed with first observation
	} else {
		lt.ema = emaAlpha*ms + (1-emaAlpha)*lt.ema
	}
	dispatchLatency.Set(lt.ema)
	lt.mu.Unlock()
}

var latency latencyTracker
