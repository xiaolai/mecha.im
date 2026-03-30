package serve

import (
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteJSONMarshalError(t *testing.T) {
	rec := httptest.NewRecorder()
	// math.Inf cannot be marshaled to JSON
	writeJSON(rec, 200, math.Inf(1))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "marshal failed") {
		t.Errorf("body = %q", rec.Body.String())
	}
}

func TestReadJSONEmpty(t *testing.T) {
	req := httptest.NewRequest("POST", "/", strings.NewReader(""))
	var v struct{}
	err := readJSON(req, &v)
	if err == nil {
		t.Error("expected error for empty body")
	}
}

func TestReadJSONValid(t *testing.T) {
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"key":"val"}`))
	var v map[string]string
	if err := readJSON(req, &v); err != nil {
		t.Fatal(err)
	}
	if v["key"] != "val" {
		t.Errorf("key = %q", v["key"])
	}
}
