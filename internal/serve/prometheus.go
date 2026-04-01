package serve

import (
	"expvar"
	"fmt"
	"net/http"
	"strings"
)

// prometheusHandler serves metrics in Prometheus text exposition format.
// Converts all expvar integers and floats to Prometheus gauge lines.
// No external dependency — pure stdlib.
func prometheusHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		var b strings.Builder
		expvar.Do(func(kv expvar.KeyValue) {
			name := sanitizeMetricName(kv.Key)
			switch v := kv.Value.(type) {
			case *expvar.Int:
				fmt.Fprintf(&b, "# TYPE mecha_%s gauge\nmecha_%s %d\n", name, name, v.Value())
			case *expvar.Float:
				fmt.Fprintf(&b, "# TYPE mecha_%s gauge\nmecha_%s %f\n", name, name, v.Value())
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
