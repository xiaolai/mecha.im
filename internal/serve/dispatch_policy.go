package serve

import (
	"context"
	"encoding/json"
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
	f, err := policy.ParseRules(entry.Worker.Policy)
	if err != nil {
		s.logger.Error("dispatch: invalid policy config, denying all write-back", "worker", workerName, "err", err)
		return &policy.DenyAll{}
	}
	return f
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

func (s *Server) doWriteBack(ctx context.Context, taskID, eventID, workerName, result string) bool {
	if eventID == "" || s.events == nil {
		return true
	}
	if s.writeback == nil && s.sources == nil {
		return true
	}
	ev, err := s.events.Get(ctx, eventID)
	if err != nil {
		s.logger.Error("dispatch: get event for writeback", "task", taskID, "err", err)
		return false
	}
	var res policy.Result
	if err := json.Unmarshal([]byte(result), &res); err != nil {
		s.logger.Warn("dispatch: parse result for policy", "task", taskID, "err", err)
		return true
	}
	policyFilter := s.getWorkerPolicy(workerName)
	filtered, decision, err := policyFilter.Apply(ctx, ev, res)
	if err != nil {
		s.logger.Error("dispatch: policy error", "task", taskID, "err", err)
		return false
	}
	s.logger.Info("dispatch: policy applied", "task", taskID, "worker", workerName,
		"allowed", decision.Allowed, "denied", decision.Denied)
	if s.sources != nil {
		if resp, ok := s.sources.GetResponder(ev.Source); ok {
			if wbErr := resp.Respond(ctx, ev, filtered); wbErr != nil {
				writebackFail.Add(1)
				s.logger.Error("dispatch: responder failed", "task", taskID, "event", eventID, "source", ev.Source, "err", wbErr)
				return false
			}
			writebackOK.Add(1)
			return true
		}
	}
	if s.writeback != nil {
		if wbErr := s.writeback.WriteBackResult(ctx, ev, filtered); wbErr != nil {
			writebackFail.Add(1)
			s.logger.Error("dispatch: write-back failed", "task", taskID, "event", eventID, "err", wbErr)
			return false
		}
		writebackOK.Add(1)
	}
	return true
}

// isUniqueViolation checks if an error is a SQLite unique constraint violation.
// Handles both modernc.org/sqlite (code 2067) and string fallback.
func isUniqueViolation(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "constraint failed") ||
		strings.Contains(msg, "code 2067")
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
