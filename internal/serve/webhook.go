package serve

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"mecha.im/internal/logs"
	"mecha.im/internal/events"
	"mecha.im/internal/source"
)

func (s *Server) handleWebhook(w http.ResponseWriter, r *http.Request) {
	sourceName := r.PathValue("source")
	src, ok := s.sources.Get(sourceName)
	if !ok {
		writeError(w, http.StatusNotFound, "unknown source: "+sourceName)
		return
	}

	// Handle verification challenges (Meta, Slack)
	if r.Method == "GET" {
		if v, ok := src.(source.Verifier); ok {
			resp, err := v.Verify(r)
			if err != nil {
				writeError(w, http.StatusForbidden, "verification failed")
				return
			}
			w.Write(resp)
			return
		}
		writeError(w, http.StatusMethodNotAllowed, "GET not supported")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20)) // 5MB limit
	if err != nil {
		writeError(w, http.StatusBadRequest, "read body failed")
		return
	}

	ev, err := src.Parse(r.Header, body)
	if err != nil {
		// Handle Slack url_verification challenge
		if errors.Is(err, source.ErrSlackChallenge) {
			if resp, ok := source.VerifyChallenge(body); ok {
				w.Header().Set("Content-Type", "application/json")
				w.Write(resp)
				return
			}
		}
		writeError(w, http.StatusUnauthorized, "webhook validation failed")
		return
	}

	exists, err := s.events.DeliveryExists(r.Context(), ev.DeliveryID)
	if err != nil {
		s.logger.Error("webhook: check delivery", "err", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if exists {
		writeJSON(w, http.StatusOK, map[string]string{"status": "duplicate"})
		return
	}

	if err := s.events.Create(r.Context(), ev); err != nil {
		if isUniqueViolation(err) || errors.Is(err, events.ErrDuplicateDedup) {
			eventsDedupSkip.Add(1)
			writeJSON(w, http.StatusOK, map[string]string{"status": "duplicate"})
			return
		}
		s.logger.Error("webhook: persist event", "err", err)
		writeError(w, http.StatusInternalServerError, "persist event failed")
		return
	}

	writeJSON(w, http.StatusAccepted, ev)

	s.record(logs.Entry{TraceID: ev.ID, EventID: ev.ID, Action: logs.EventReceived, Outcome: logs.OK,
		Detail: logs.MarshalDetail(map[string]string{"source": ev.Source, "type": ev.Type})})

	webhooksReceived.Add(1)
	// Match + hydrate + dispatch in background with timeout
	ctx, cancel := context.WithTimeout(withTraceID(context.Background()), 5*time.Minute)
	go func() {
		defer cancel()
		defer func() {
			if r := recover(); r != nil {
				s.logger.Error("webhook: panic in matchAndHydrate", "event", ev.ID, "panic", r)
			}
		}()
		s.logger.Info("webhook: processing", "event", ev.ID, "trace", traceID(ctx))
		s.matchAndHydrate(ctx, ev, src)
	}()
}

func (s *Server) matchAndHydrate(ctx context.Context, ev *events.Event, src source.Source) {
	if err := s.reg.Reload(); err != nil {
		s.logger.Error("webhook: reload registry", "err", err)
	}

	hydrated := false
	entries := s.reg.List()
	for _, entry := range entries {
		for _, rule := range entry.Worker.Events {
			if !matchesRule(rule, ev) {
				continue
			}
			if !rule.IsAuto() {
				s.logger.Info("webhook: rule matched but auto=false, skipping", "event", ev.ID, "worker", entry.Worker.Name)
				continue
			}

			// Hydrate once on first match — avoids wasted API calls
			// when no rule matches, and avoids duplicate calls when
			// multiple rules match.
			if !hydrated {
				if h, ok := src.(source.Hydrator); ok {
					if err := h.Hydrate(ctx, ev); err != nil {
						s.logger.Warn("webhook: hydrate", "event", ev.ID, "err", err)
					}
					if err := s.events.UpdateAttrs(ctx, ev.ID, ev.Attrs); err != nil {
						s.logger.Warn("webhook: persist hydrated attrs", "event", ev.ID, "err", err)
					}
				}
				hydrated = true
			}

			prompt, err := renderPrompt(rule, ev)
			if err != nil {
				s.logger.Error("webhook: render prompt", "event", ev.ID, "err", err)
				if err := s.events.SetFailed(ctx, ev.ID); err != nil {
					s.logger.Error("webhook: set failed", "event", ev.ID, "err", err)
				}
				return
			}

			if err := s.events.SetMatched(ctx, ev.ID, entry.Worker.Name); err != nil {
				s.logger.Error("webhook: set matched", "event", ev.ID, "err", err)
				return
			}
			s.record(logs.Entry{TraceID: ev.ID, EventID: ev.ID, Worker: entry.Worker.Name, Action: logs.EventMatched, Outcome: logs.OK})

			taskCtx, ctxErr := buildTaskContext(ev)
			if ctxErr != nil {
				s.logger.Error("webhook: build task context", "event", ev.ID, "err", ctxErr)
			}
			t, err := s.tasks.CreateWithEvent(ctx, entry.Worker.Name, prompt, taskCtx, ev.ID)
			if err != nil {
				s.logger.Error("webhook: create task", "event", ev.ID, "err", err)
				if err := s.events.SetFailed(ctx, ev.ID); err != nil {
					s.logger.Error("webhook: set failed", "event", ev.ID, "err", err)
				}
				return
			}

			if err := s.events.SetDispatched(ctx, ev.ID, t.ID); err != nil {
				s.logger.Error("webhook: set dispatched failed, failing task", "event", ev.ID, "err", err)
				if failErr := s.tasks.Fail(ctx, t.ID, "event transition failed"); failErr != nil {
					s.logger.Error("webhook: compensate task fail", "task", t.ID, "err", failErr)
				}
				return
			}
			select {
			case s.pending <- t.ID:
			case <-ctx.Done():
				s.logger.Error("webhook: enqueue timed out", "event", ev.ID, "task", t.ID)
				return
			}
			s.logger.Info("webhook: dispatched", "event", ev.ID, "task", t.ID, "worker", entry.Worker.Name)
			return
		}
	}

	if err := s.events.SetSkipped(ctx, ev.ID); err != nil {
		s.logger.Error("webhook: set skipped", "event", ev.ID, "err", err)
	}
	s.logger.Info("webhook: no matching worker", "event", ev.ID, "type", ev.Type)
}

func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	evList, err := s.events.List(r.Context(), state)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if evList == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, evList)
}

func (s *Server) handleGetEvent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ev, err := s.events.Get(r.Context(), id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "event not found")
		} else {
			writeError(w, http.StatusInternalServerError, "internal error")
		}
		return
	}
	writeJSON(w, http.StatusOK, ev)
}
