package serve

import (
	"context"
	"crypto/rand"
	"encoding/hex"
)

type traceKey struct{}

// withTraceID adds a trace ID to the context.
func withTraceID(ctx context.Context) context.Context {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return ctx // degrade gracefully — no trace ID
	}
	return context.WithValue(ctx, traceKey{}, hex.EncodeToString(b))
}

// traceID extracts the trace ID from context, or returns "none".
func traceID(ctx context.Context) string {
	if v, ok := ctx.Value(traceKey{}).(string); ok {
		return v
	}
	return "none"
}
