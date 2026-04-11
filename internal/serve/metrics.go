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
	eventsDedupSkip      = expvar.NewInt("events_dedup_skipped")
	cronTicksDropped     = expvar.NewInt("cron_ticks_dropped_total")
	webhooksRateLimited  = expvar.NewInt("webhooks_rate_limited")
)

// latencyTracker tracks dispatch latency as both an EMA (for the expvar gauge)
// and a histogram (for Prometheus percentile queries). The histogram uses fixed
// bucket boundaries in milliseconds, chosen for LLM task latencies.
const emaAlpha = 0.1

// histogramBuckets are upper bounds in milliseconds for the Prometheus histogram.
// Covers sub-second to 10-minute tasks.
var histogramBuckets = []float64{
	100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000, 300000, 600000,
}

type latencyTracker struct {
	mu      sync.Mutex
	ema     float64
	buckets []uint64 // cumulative counts per bucket
	count   uint64
	sum     float64
}

func (lt *latencyTracker) observe(d time.Duration) {
	lt.mu.Lock()
	ms := float64(d.Milliseconds())
	if lt.ema == 0 {
		lt.ema = ms
	} else {
		lt.ema = emaAlpha*ms + (1-emaAlpha)*lt.ema
	}
	dispatchLatency.Set(lt.ema)

	// Update histogram
	lt.count++
	lt.sum += ms
	if lt.buckets == nil {
		lt.buckets = make([]uint64, len(histogramBuckets))
	}
	for i, bound := range histogramBuckets {
		if ms <= bound {
			lt.buckets[i]++
		}
	}
	lt.mu.Unlock()
}

// snapshot returns a copy of the histogram state for rendering.
func (lt *latencyTracker) snapshot() (buckets []uint64, count uint64, sum float64) {
	lt.mu.Lock()
	if lt.buckets != nil {
		buckets = make([]uint64, len(lt.buckets))
		copy(buckets, lt.buckets)
	}
	count = lt.count
	sum = lt.sum
	lt.mu.Unlock()
	return
}

var latency latencyTracker
