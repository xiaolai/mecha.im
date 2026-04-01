package serve

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"mecha.im/internal/source"
)

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// /health and /metrics are always public for probes and scrapers.
		if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		// No API key configured → all endpoints open (operator's choice).
		if s.apiKey == "" {
			next.ServeHTTP(w, r)
			return
		}
		// Webhook paths: only skip API key auth if the source has its own
		// auth (HMAC signature, token validation). Sources without auth
		// (like GenericSource) must pass the API key check.
		if strings.HasPrefix(r.URL.Path, "/webhook/") && s.sources != nil {
			sourceName := strings.TrimPrefix(r.URL.Path, "/webhook/")
			if src, ok := s.sources.Get(sourceName); ok {
				if _, hasAuth := src.(source.Authenticated); hasAuth {
					next.ServeHTTP(w, r)
					return
				}
			}
		}
		auth := r.Header.Get("Authorization")
		key := r.Header.Get("X-API-Key")
		expected := []byte(s.apiKey)
		bearerMatch := subtle.ConstantTimeCompare([]byte(strings.TrimPrefix(auth, "Bearer ")), expected) == 1
		keyMatch := subtle.ConstantTimeCompare([]byte(key), expected) == 1
		if bearerMatch || keyMatch {
			next.ServeHTTP(w, r)
			return
		}
		writeError(w, http.StatusUnauthorized, "unauthorized")
	})
}
