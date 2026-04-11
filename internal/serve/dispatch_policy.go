package serve

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"

	"mecha.im/internal/logs"
	"mecha.im/internal/policies"
)

func (s *Server) getWorkerPolicy(workerName string) policies.Filter {
	entry, ok := s.reg.Get(workerName)
	if !ok || entry.Worker.Policy == nil {
		if ok && entry.Worker.IsManaged() {
			// Managed workers (Docker) should always have a policy section.
			// Without one, AllowAll is the fallback — a compromised image can
			// post comments, labels, and diffs unfiltered. Log at Error so
			// operators see this in alerting pipelines.
			s.logger.Error("dispatch: managed worker has no policy — all write-back allowed (add policy section to worker YAML)", "worker", workerName)
		} else {
			s.logger.Warn("dispatch: no policy configured, using AllowAll", "worker", workerName)
		}
		return &policies.AllowAll{}
	}
	f, err := policies.ParseRules(entry.Worker.Policy)
	if err != nil {
		s.logger.Error("dispatch: invalid policy config, denying all write-back", "worker", workerName, "err", err)
		return &policies.DenyAll{}
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

// doWriteBack applies policy filtering and writes the result back to the source
// platform (GitHub comment, label, status, etc.). Returns (true, nil) on
// success, (false, err) on failure. A nil error with false means write-back
// was intentionally skipped (no writeback configured).
func (s *Server) doWriteBack(ctx context.Context, taskID, eventID, workerName, result string) (bool, error) {
	if eventID == "" || s.events == nil {
		return true, nil
	}
	if s.writeback == nil && s.sources == nil {
		return true, nil
	}
	ev, err := s.events.Get(ctx, eventID)
	if err != nil {
		s.logger.Error("dispatch: get event for writeback", "task", taskID, "err", err)
		return false, err
	}
	var res policies.Result
	if err := json.Unmarshal([]byte(result), &res); err != nil {
		s.logger.Warn("dispatch: parse result for policy", "task", taskID, "err", err)
		return true, nil
	}
	policyFilter := s.getWorkerPolicy(workerName)
	filtered, decision, err := policyFilter.Apply(ctx, ev, res)
	if err != nil {
		s.logger.Error("dispatch: policy error", "task", taskID, "err", err)
		return false, err
	}
	s.logger.Info("dispatch: policy applied", "task", taskID, "worker", workerName,
		"allowed", decision.Allowed, "denied", decision.Denied)
	policyOutcome := logs.OK
	if len(decision.Denied) > 0 {
		policyOutcome = logs.Deny
	}
	s.record(logs.Entry{TraceID: eventID, TaskID: taskID, Worker: workerName, Action: logs.PolicyApplied, Outcome: policyOutcome,
		Detail: logs.MarshalDetail(map[string]any{"allowed": decision.Allowed, "denied": decision.Denied})})
	if s.sources != nil {
		if resp, ok := s.sources.GetResponder(ev.Source); ok {
			if wbErr := resp.Respond(ctx, ev, filtered); wbErr != nil {
				writebackFail.Add(1)
				s.logger.Error("dispatch: responder failed", "task", taskID, "event", eventID, "source", ev.Source, "err", wbErr)
				return false, wbErr
			}
			writebackOK.Add(1)
			return true, nil
		}
	}
	if s.writeback != nil {
		if wbErr := s.writeback.WriteBackResult(ctx, ev, filtered); wbErr != nil {
			writebackFail.Add(1)
			s.logger.Error("dispatch: write-back failed", "task", taskID, "event", eventID, "err", wbErr)
			return false, wbErr
		}
		writebackOK.Add(1)
	}
	return true, nil
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
	// context.Canceled means server shutdown, not a transport failure.
	// Classifying it as transport would cause a retry storm on restart.
	if errors.Is(err, context.Canceled) {
		return false
	}
	// Check typed network errors first
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	// Fallback: string matching for wrapped errors that lose type info
	msg := err.Error()
	if strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "deadline exceeded") {
		return true
	}
	// Specific 5xx codes that indicate transient failure:
	//   502 Bad Gateway  — worker container restarting / upstream unreachable
	//   503 Unavailable  — worker explicitly busy or health check failing
	//   504 Timeout      — worker took too long to respond
	// 500/501/505 may indicate a permanent worker bug — don't amplify with retries.
	return strings.Contains(msg, "worker returned 502") ||
		strings.Contains(msg, "worker returned 503") ||
		strings.Contains(msg, "worker returned 504")
}
