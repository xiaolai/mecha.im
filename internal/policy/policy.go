package policy

import "context"

// Filter decides what parts of a worker result are allowed through.
type Filter interface {
	FilterResult(ctx context.Context, result map[string]any) (map[string]any, error)
}

// PassThrough allows all results through unmodified.
// This is the Phase 4 stub — real filtering comes in Phase 5.
type PassThrough struct{}

// FilterResult returns the result unchanged.
func (p *PassThrough) FilterResult(_ context.Context, result map[string]any) (map[string]any, error) {
	return result, nil
}
