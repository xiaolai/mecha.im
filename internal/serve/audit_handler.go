package serve

import (
	"net/http"
	"strconv"
	"time"

	"mecha.im/internal/logs"
)

// record is a nil-safe helper that writes a log entry if the log store exists.
func (s *Server) record(e logs.Entry) {
	if s.logs != nil {
		s.logs.Record(e)
	}
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := logs.Filter{
		TraceID: q.Get("trace"),
		EventID: q.Get("event"),
		TaskID:  q.Get("task"),
		Worker:  q.Get("worker"),
		Action:  q.Get("action"),
	}
	if since := q.Get("since"); since != "" {
		if d, err := time.ParseDuration(since); err == nil {
			f.Since = time.Now().Add(-d)
		}
	}
	if limit := q.Get("limit"); limit != "" {
		if n, err := strconv.Atoi(limit); err == nil {
			f.Limit = n
		}
	}

	entries, err := s.logs.Query(r.Context(), f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "log query failed")
		return
	}
	if entries == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, entries)
}
