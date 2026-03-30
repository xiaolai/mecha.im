package serve

import (
	"net/http"
)

type taskRequest struct {
	Prompt string `json:"prompt"`
	Worker string `json:"worker"`
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handlePostTask(w http.ResponseWriter, r *http.Request) {
	var req taskRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if req.Worker == "" {
		// Auto-select: pick first online worker
		entries := s.reg.List()
		for _, e := range entries {
			if e.State == "online" {
				req.Worker = e.Worker.Name
				break
			}
		}
		if req.Worker == "" {
			writeError(w, http.StatusServiceUnavailable, "no online workers")
			return
		}
	}

	t, err := s.tasks.Create(r.Context(), req.Worker, req.Prompt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	select {
	case s.pending <- t.ID:
		writeJSON(w, http.StatusAccepted, t)
	default:
		_ = s.tasks.Fail(r.Context(), t.ID, "task queue full")
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
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	tasks, err := s.tasks.List(r.Context(), state)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
	writeJSON(w, http.StatusOK, entries)
}
