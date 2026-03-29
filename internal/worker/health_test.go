package worker

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCheckHealth(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
		wantErr bool
	}{
		{
			name:    "healthy",
			handler: func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) },
			wantErr: false,
		},
		{
			name:    "unhealthy",
			handler: func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) },
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(tt.handler)
			defer srv.Close()
			err := CheckHealth(srv.URL, 5*time.Second)
			if tt.wantErr && err == nil {
				t.Error("expected error")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestCheckHealthUnreachable(t *testing.T) {
	err := CheckHealth("http://127.0.0.1:1", 1*time.Second)
	if err == nil {
		t.Error("expected error for unreachable endpoint")
	}
}
