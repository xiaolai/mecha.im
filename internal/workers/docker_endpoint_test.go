package workers

import "testing"

func TestExtractHost(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"tcp://remote:2375", "remote"},
		{"tcp://192.168.1.50:2375", "192.168.1.50"},
		{"tcp://docker.example.com:2376", "docker.example.com"},
		{"unix:///var/run/docker.sock", ""},
		{"tcp://localhost:2375", ""},
		{"tcp://127.0.0.1:2375", ""},
		{"tcp://::1:2375", ""},
		{"", ""},
		{"remote:2375", "remote"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := extractHost(tt.input)
			if got != tt.want {
				t.Errorf("extractHost(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
