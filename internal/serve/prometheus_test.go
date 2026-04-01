package serve

import (
	"expvar"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrometheusHandler(t *testing.T) {
	// Set some expvar values for the test.
	// expvar is a global registry; use unique names to avoid cross-test collisions.
	counter := expvar.NewInt("test_prom_events_total")
	counter.Set(42)
	gauge := expvar.NewFloat("test_prom_latency_ms")
	gauge.Set(3.14)

	handler := prometheusHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/plain") {
		t.Errorf("content-type = %q, want containing text/plain", ct)
	}

	body := w.Body.String()

	// Check for our int metric
	if !strings.Contains(body, "mecha_test_prom_events_total 42") {
		t.Errorf("body missing int metric, got:\n%s", body)
	}
	if !strings.Contains(body, "# TYPE mecha_test_prom_events_total gauge") {
		t.Errorf("body missing TYPE line for int metric, got:\n%s", body)
	}

	// Check for our float metric
	if !strings.Contains(body, "mecha_test_prom_latency_ms 3.14") {
		t.Errorf("body missing float metric, got:\n%s", body)
	}
	if !strings.Contains(body, "# TYPE mecha_test_prom_latency_ms gauge") {
		t.Errorf("body missing TYPE line for float metric, got:\n%s", body)
	}
}

func TestSanitizeMetricName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"simple", "simple"},
		{"with.dots", "with_dots"},
		{"with spaces", "with_spaces"},
		{"with-dashes", "with_dashes"},
		{"CamelCase", "CamelCase"},
		{"under_score", "under_score"},
		{"colon:ok", "colon:ok"},
		{"123start_num", "_23start_num"},
		{"a1b2c3", "a1b2c3"},
		{"special!@#$chars", "special____chars"},
		{"", ""},
		{"a", "a"},
		{"_leading", "_leading"},
		{"with/slash", "with_slash"},
		{"with=equals", "with_equals"},
		{"emoji\U0001F600here", "emoji_here"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeMetricName(tt.input)
			if got != tt.want {
				t.Errorf("sanitizeMetricName(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestPrometheusHandlerStringVarsIgnored(t *testing.T) {
	// String expvar values should be silently ignored (not Int or Float)
	expvar.NewString("test_prom_version").Set("v1.0.0")

	handler := prometheusHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()
	if strings.Contains(body, "test_prom_version") {
		t.Errorf("string var should not appear in prometheus output, got:\n%s", body)
	}
}
