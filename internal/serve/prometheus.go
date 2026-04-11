package serve

import (
	"expvar"
	"fmt"
	"net/http"
	"strings"
)

// counterMetrics lists expvar names that are monotonically increasing counters.
var counterMetrics = map[string]bool{
	"tasks_created": true, "tasks_completed": true, "tasks_failed": true,
	"tasks_recovered": true, "tasks_retried": true, "tasks_dedup_skipped": true,
	"tasks_rate_limited": true, "webhooks_received": true,
	"writeback_ok": true, "writeback_fail": true, "events_dedup_skipped": true,
	"writeback_retry_ok": true, "writeback_dead_letter": true,
	"cron_ticks_dropped_total": true,
}

// prometheusHandler serves metrics in Prometheus text exposition format.
// Distinguishes counters (monotonically increasing) from gauges.
// No external dependency — pure stdlib.
func prometheusHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		var b strings.Builder
		expvar.Do(func(kv expvar.KeyValue) {
			name := sanitizeMetricName(kv.Key)
			ptype := "gauge"
			if counterMetrics[kv.Key] {
				ptype = "counter"
			}
			switch v := kv.Value.(type) {
			case *expvar.Int:
				fmt.Fprintf(&b, "# TYPE mecha_%s %s\nmecha_%s %d\n", name, ptype, name, v.Value())
			case *expvar.Float:
				fmt.Fprintf(&b, "# TYPE mecha_%s %s\nmecha_%s %f\n", name, ptype, name, v.Value())
			}
		})
		w.Write([]byte(b.String()))
	}
}

// sanitizeMetricName converts an expvar key to a Prometheus-compatible metric name.
// Prometheus requires [a-zA-Z_:][a-zA-Z0-9_:]*.
func sanitizeMetricName(name string) string {
	var b strings.Builder
	for i, c := range name {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c == '_', c == ':':
			b.WriteRune(c)
		case c >= '0' && c <= '9' && i > 0:
			b.WriteRune(c)
		default:
			b.WriteRune('_')
		}
	}
	return b.String()
}
