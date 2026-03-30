package serve

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"text/template"
	"time"

	"mecha.im/internal/event"
	"mecha.im/internal/source"
	"mecha.im/internal/worker"
)

func (s *Server) handleWebhook(w http.ResponseWriter, r *http.Request) {
	sourceName := r.PathValue("source")
	src, ok := s.sources.Get(sourceName)
	if !ok {
		writeError(w, http.StatusNotFound, "unknown source: "+sourceName)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20)) // 5MB limit
	if err != nil {
		writeError(w, http.StatusBadRequest, "read body failed")
		return
	}

	ev, err := src.Parse(r.Header, body)
	if err != nil {
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
		s.logger.Error("webhook: persist event", "err", err)
		writeError(w, http.StatusInternalServerError, "persist event failed")
		return
	}

	writeJSON(w, http.StatusAccepted, ev)

	// Match + hydrate + dispatch in background with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	go func() {
		defer cancel()
		defer func() {
			if r := recover(); r != nil {
				s.logger.Error("webhook: panic in matchAndHydrate", "event", ev.ID, "panic", r)
			}
		}()
		s.matchAndHydrate(ctx, ev, src)
	}()
}

func (s *Server) matchAndHydrate(ctx context.Context, ev *event.Event, src source.Source) {
	if err := s.reg.Reload(); err != nil {
		s.logger.Error("webhook: reload registry", "err", err)
	}

	entries := s.reg.List()
	for _, entry := range entries {
		for _, rule := range entry.Worker.Events {
			if !matchesRule(rule, ev) {
				continue
			}

			// Hydrate if source supports it
			if h, ok := src.(source.Hydrator); ok {
				if err := h.Hydrate(ctx, ev); err != nil {
					s.logger.Warn("webhook: hydrate", "event", ev.ID, "err", err)
				}
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

			taskCtx := buildTaskContext(ev)
			t, err := s.tasks.CreateWithEvent(ctx, entry.Worker.Name, prompt, taskCtx, ev.ID)
			if err != nil {
				s.logger.Error("webhook: create task", "event", ev.ID, "err", err)
				if err := s.events.SetFailed(ctx, ev.ID); err != nil {
					s.logger.Error("webhook: set failed", "event", ev.ID, "err", err)
				}
				return
			}

			if err := s.events.SetDispatched(ctx, ev.ID, t.ID); err != nil {
				s.logger.Error("webhook: set dispatched", "event", ev.ID, "err", err)
			}
			s.pending <- t.ID
			s.logger.Info("webhook: dispatched", "event", ev.ID, "task", t.ID, "worker", entry.Worker.Name)
			return
		}
	}

	if err := s.events.SetSkipped(ctx, ev.ID); err != nil {
		s.logger.Error("webhook: set skipped", "event", ev.ID, "err", err)
	}
	s.logger.Info("webhook: no matching worker", "event", ev.ID, "type", ev.Type)
}

func matchesRule(rule worker.EventRule, ev *event.Event) bool {
	if rule.Source != ev.Source {
		return false
	}
	matched := false
	for _, on := range rule.On {
		if on == ev.Type {
			matched = true
			break
		}
	}
	if !matched {
		return false
	}
	for k, v := range rule.Filter {
		actual := fmt.Sprint(ev.Payload[k])
		if actual != v {
			return false
		}
	}
	return true
}

func renderPrompt(rule worker.EventRule, ev *event.Event) (string, error) {
	tmpl, err := template.New("prompt").Parse(rule.Prompt)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}
	data := make(map[string]any)
	data["repo_owner"] = ev.RepoOwner
	data["repo_name"] = ev.RepoName
	data["ref"] = ev.Ref
	data["number"] = ev.Number
	data["sender"] = ev.Sender
	for k, v := range ev.Payload {
		data[k] = v
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}
	return buf.String(), nil
}

func buildTaskContext(ev *event.Event) string {
	ctx := map[string]any{
		"repo":   ev.RepoOwner + "/" + ev.RepoName,
		"number": ev.Number,
		"ref":    ev.Ref,
		"sender": ev.Sender,
	}
	if diff, ok := ev.Payload["diff"]; ok {
		ctx["diff"] = diff
	}
	if files, ok := ev.Payload["file_list"]; ok {
		ctx["files"] = files
	}
	if sha, ok := ev.Payload["head_sha"]; ok {
		ctx["head_sha"] = sha
	}
	b, _ := json.Marshal(ctx)
	return string(b)
}

func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	events, err := s.events.List(r.Context(), state)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if events == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, events)
}

func (s *Server) handleGetEvent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ev, err := s.events.Get(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "event not found")
		return
	}
	writeJSON(w, http.StatusOK, ev)
}
