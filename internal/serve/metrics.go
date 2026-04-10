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
	dispatchLatency  = expvar.NewFloat("dispatch_latency_ms_avg")
	queueDepth       = expvar.NewInt("queue_depth")
	webhooksReceived = expvar.NewInt("webhooks_received")
	writebackOK         = expvar.NewInt("writeback_ok")
	writebackFail       = expvar.NewInt("writeback_fail")
	writebackRetryOK    = expvar.NewInt("writeback_retry_ok")
	writebackDeadLetter = expvar.NewInt("writeback_dead_letter")
	eventsDedupSkip     = expvar.NewInt("events_dedup_skipped")
)

// latencyTracker keeps a running average of dispatch latency (thread-safe).
type latencyTracker struct {
	mu    sync.Mutex
	sum   float64
	count int64
}

func (lt *latencyTracker) observe(d time.Duration) {
	lt.mu.Lock()
	lt.count++
	lt.sum += float64(d.Milliseconds())
	dispatchLatency.Set(lt.sum / float64(lt.count))
	lt.mu.Unlock()
}

var latency latencyTracker
