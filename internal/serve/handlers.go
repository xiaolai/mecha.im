package serve

import (
	"net/http"
	"strings"
	"sync/atomic"

	"mecha.im/internal/worker"
)

type taskRequest struct {
	Prompt string `json:"prompt"`
	Worker string `json:"worker"`
}

var workerRoundRobin atomic.Uint64

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handlePostTask(w http.ResponseWriter, r *http.Request) {
	var req taskRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if req.Worker == "" {
		entries := s.reg.List()
		var online []string
		for _, e := range entries {
			if e.State == worker.StateOnline {
				online = append(online, e.Worker.Name)
			}
		}
		if len(online) == 0 {
			writeError(w, http.StatusServiceUnavailable, "no online workers")
			return
		}
		idx := workerRoundRobin.Add(1)
		req.Worker = online[int(idx-1)%len(online)]
	}

	t, err := s.tasks.Create(r.Context(), req.Worker, req.Prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create task")
		return
	}

	select {
	case s.pending <- t.ID:
		writeJSON(w, http.StatusAccepted, t)
	default:
		if err := s.tasks.Fail(r.Context(), t.ID, "task queue full"); err != nil {
			s.logger.Error("fail task on queue full", "id", t.ID, "err", err)
		}
		writeError(w, http.StatusTooManyRequests, "task queue full")
	}
}

func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing task id")
		return
	}
	t, err := s.tasks.Get(r.Context(), id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "task not found")
		} else {
			writeError(w, http.StatusInternalServerError, "internal error")
		}
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	tasks, err := s.tasks.List(r.Context(), state)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if tasks == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, tasks)
}

func (s *Server) handleListWorkers(w http.ResponseWriter, r *http.Request) {
	entries := s.reg.List()
	sanitized := make([]worker.Entry, len(entries))
	for i := range entries {
		sanitized[i] = entries[i].Sanitized()
	}
	writeJSON(w, http.StatusOK, sanitized)
}
