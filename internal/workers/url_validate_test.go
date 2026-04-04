package workers

import (
	"strings"
	"testing"
)

func TestValidateUpstreamURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr string
	}{
		{"valid external", "http://93.184.216.34:11434", ""},
		{"valid localhost", "http://127.0.0.1:11434", ""},
		{"valid private 10.x", "http://10.0.0.5:11434", ""},
		{"valid private 192.168.x", "http://192.168.1.1:11434", ""},
		{"metadata blocked", "http://169.254.169.254/latest/meta-data", "blocked"},
		{"link-local blocked", "http://169.254.1.1:80", "blocked"},
		{"bad scheme", "ftp://example.com", "scheme must be http or https"},
		{"no scheme", "example.com:11434", "scheme must be http or https"},
		{"empty host", "http:///path", "no host"},
		{"zero network blocked", "http://0.0.0.1:80", "blocked"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateUpstreamURL(tt.url)
			if tt.wantErr == "" {
				if err != nil {
					t.Errorf("ValidateUpstreamURL(%q) = %v, want nil", tt.url, err)
				}
			} else {
				if err == nil {
					t.Errorf("ValidateUpstreamURL(%q) = nil, want error containing %q", tt.url, tt.wantErr)
				} else if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("ValidateUpstreamURL(%q) = %v, want error containing %q", tt.url, err, tt.wantErr)
				}
			}
		})
	}
}
