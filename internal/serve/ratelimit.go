package serve

import (
	"context"
	"sync"
	"time"
)

// RateLimiter implements per-worker token bucket rate limiting.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64       // tokens per second
	burst   int           // max tokens
	window  time.Duration // cleanup interval for stale buckets
}

type bucket struct {
	tokens    float64
	lastFill  time.Time
	rate      float64
	burst     int
}

// NewRateLimiter creates a rate limiter with the given per-worker rate and burst.
// rate is requests per second per worker. burst is max concurrent.
func NewRateLimiter(rate float64, burst int) *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*bucket),
		rate:    rate,
		burst:   burst,
		window:  10 * time.Minute,
	}
}

// Allow checks if a request for the given worker is allowed.
// Returns true if a token was consumed, false if rate limited.
func (rl *RateLimiter) Allow(workerName string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[workerName]
	if !ok {
		b = &bucket{
			tokens:   float64(rl.burst),
			lastFill: time.Now(),
			rate:     rl.rate,
			burst:    rl.burst,
		}
		rl.buckets[workerName] = b
	}

	now := time.Now()
	elapsed := now.Sub(b.lastFill).Seconds()
	b.tokens += elapsed * b.rate
	if b.tokens > float64(b.burst) {
		b.tokens = float64(b.burst)
	}
	b.lastFill = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Cleanup removes stale buckets that haven't been used recently.
func (rl *RateLimiter) Cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := time.Now().Add(-rl.window)
	for name, b := range rl.buckets {
		if b.lastFill.Before(cutoff) {
			delete(rl.buckets, name)
		}
	}
}

// limiterCleanupLoop runs rate limiter cleanup periodically until ctx is cancelled.
func (s *Server) limiterCleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.limiter.Cleanup()
		}
	}
}
