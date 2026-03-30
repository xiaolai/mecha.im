package serve

import (
	"context"
	"errors"
	"net"
	"strings"

	"mecha.im/internal/policy"
)

func (s *Server) getWorkerPolicy(workerName string) policy.Filter {
	entry, ok := s.reg.Get(workerName)
	if !ok || entry.Worker.Policy == nil {
		s.logger.Warn("dispatch: no policy configured, using AllowAll", "worker", workerName)
		return &policy.AllowAll{}
	}
	return policy.ParseRules(entry.Worker.Policy)
}

func (s *Server) completeEvent(ctx context.Context, eventID string, success bool) {
	if eventID == "" || s.events == nil {
		return
	}
	if success {
		if err := s.events.SetCompleted(ctx, eventID); err != nil {
			s.logger.Error("dispatch: set event completed", "event", eventID, "err", err)
		}
	} else {
		if err := s.events.SetFailed(ctx, eventID); err != nil {
			s.logger.Error("dispatch: set event failed", "event", eventID, "err", err)
		}
	}
}

func isTransportError(err error) bool {
	// Check typed network errors first
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	// Fallback: string matching for wrapped errors that lose type info
	msg := err.Error()
	return strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "deadline exceeded") ||
		strings.Contains(msg, "context canceled") ||
		strings.Contains(msg, "EOF")
}
