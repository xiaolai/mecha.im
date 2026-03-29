package worker

import "testing"

func TestRedactSecrets(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "anthropic oauth token",
			input: "token: sk-ant-oat01-abc123XYZ",
			want:  "token: [REDACTED]",
		},
		{
			name:  "anthropic api key",
			input: "key: sk-ant-api03-abc123XYZ",
			want:  "key: [REDACTED]",
		},
		{
			name:  "openai api key",
			input: "failed with sk-proj-abc123XYZdef456",
			want:  "failed with [REDACTED]",
		},
		{
			name:  "github pat",
			input: "auth error: ghp_abc123XYZ expired",
			want:  "auth error: [REDACTED] expired",
		},
		{
			name:  "github server token",
			input: "token ghs_abc123 revoked",
			want:  "token [REDACTED] revoked",
		},
		{
			name:  "google api key",
			input: "key: AIzaSyBmmkGm-aBIqk0aJ414wGsl72V6XgZvJHI",
			want:  "key: [REDACTED]",
		},
		{
			name:  "google oauth access token",
			input: "token: ya29.a0ATkoCc4abc123",
			want:  "token: [REDACTED]",
		},
		{
			name:  "jwt token",
			input: "token: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload",
			want:  "token: [REDACTED].payload",
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
