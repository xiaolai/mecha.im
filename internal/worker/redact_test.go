package worker

import "testing"

func TestRedactSecrets(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "github pat",
			input: "auth error: ghp_abc123XYZ expired",
			want:  "auth error: [REDACTED] expired",
		},
		{
			name:  "anthropic key",
			input: "failed with sk-ant-api03-abc123",
			want:  "failed with [REDACTED]",
		},
		{
			name:  "github server token",
			input: "token ghs_abc123 revoked",
			want:  "token [REDACTED] revoked",
		},
		{
			name:  "bearer token",
			input: "header: Bearer eyJhbGciOiJIUzI1NiJ9.test",
			want:  "header: [REDACTED]",
		},
		{
			name:  "no secrets",
			input: "connection refused",
			want:  "connection refused",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := RedactSecrets(tt.input)
			if got != tt.want {
				t.Errorf("RedactSecrets(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
