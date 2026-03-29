package worker

import (
	"regexp"
	"testing"
)

func TestParseMemory(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    int64
		wantErr bool
	}{
		{"1G", "1G", 1 << 30, false},
		{"2G", "2G", 2 << 30, false},
		{"1g_lower", "1g", 1 << 30, false},
		{"512M", "512M", 512 << 20, false},
		{"1m_lower", "1m", 1 << 20, false},
		{"8G", "8G", 8 << 30, false},
		{"empty", "", 0, true},
		{"single_char", "M", 0, true},
		{"zero_G", "0G", 0, true},
		{"negative", "-1G", 0, true},
		{"non_numeric", "abcM", 0, true},
		{"unknown_unit_K", "1K", 0, true},
		{"unknown_unit_T", "1T", 0, true},
		{"no_unit", "1024", 0, true},
		{"overflow", "9999999999G", 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseMemory(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("parseMemory(%q) = %d, want error", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseMemory(%q) error: %v", tt.input, err)
			}
			if got != tt.want {
				t.Errorf("parseMemory(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestCurrentUser(t *testing.T) {
	u, err := CurrentUser()
	if err != nil {
		t.Fatalf("CurrentUser() error: %v", err)
	}
	pattern := regexp.MustCompile(`^\d+:\d+$`)
	if !pattern.MatchString(u) {
		t.Errorf("CurrentUser() = %q, want uid:gid format", u)
	}
}
