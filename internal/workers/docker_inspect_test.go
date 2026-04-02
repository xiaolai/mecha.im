package workers

import (
	"errors"
	"fmt"
	"testing"
)

type mockNotFound struct{}

func (e mockNotFound) Error() string { return "not found" }
func (e mockNotFound) NotFound()     {}

func TestIsNotFound(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"not found error", mockNotFound{}, true},
		{"generic error", errors.New("something"), false},
		{"wrapped not found", fmt.Errorf("wrap: %w", mockNotFound{}), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isNotFound(tt.err); got != tt.want {
				t.Errorf("isNotFound = %v, want %v", got, tt.want)
			}
		})
	}
}
