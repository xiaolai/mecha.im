package ssh

import "testing"

func TestParseRemotePort(t *testing.T) {
	tests := []struct {
		name    string
		output  string
		want    int
		wantErr bool
	}{
		{
			name:   "listening on colon port",
			output: "listening on :8081\n",
			want:   8081,
		},
		{
			name:   "plain number",
			output: "9090\n",
			want:   9090,
		},
		{
			name:   "url with port",
			output: "http://0.0.0.0:3000",
			want:   3000,
		},
		{
			name:    "empty",
			output:  "",
			wantErr: true,
		},
		{
			name:    "no port",
			output:  "started server",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseRemotePort(tt.output)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("ParseRemotePort() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestFreePort(t *testing.T) {
	port, err := freePort()
	if err != nil {
		t.Fatalf("freePort() error: %v", err)
	}
	if port <= 0 || port > 65535 {
		t.Errorf("freePort() = %d, want valid port", port)
	}
}
