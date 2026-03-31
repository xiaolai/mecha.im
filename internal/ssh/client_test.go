package ssh

import (
	"testing"
)

func TestBaseArgs(t *testing.T) {
	tests := []struct {
		name string
		c    Client
		want []string // subset that must appear
	}{
		{
			name: "default port",
			c:    Client{Host: "host", User: "user", Port: 22},
			want: []string{"BatchMode=yes"},
		},
		{
			name: "custom port",
			c:    Client{Host: "host", User: "user", Port: 2222},
			want: []string{"-p", "2222"},
		},
		{
			name: "custom key",
			c:    Client{Host: "host", User: "user", Port: 22, Key: "/tmp/id_ed25519"},
			want: []string{"-i", "/tmp/id_ed25519"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args := tt.c.baseArgs()
			for _, w := range tt.want {
				found := false
				for _, a := range args {
					if a == w {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("baseArgs() missing %q, got %v", w, args)
				}
			}
		})
	}
}

func TestDestination(t *testing.T) {
	c := &Client{Host: "100.100.1.7", User: "joker"}
	got := c.destination()
	if got != "joker@100.100.1.7" {
		t.Errorf("destination() = %q, want %q", got, "joker@100.100.1.7")
	}
}
