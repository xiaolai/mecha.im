package serve

import (
	"testing"
	"time"
)

func TestRateLimiterAllow(t *testing.T) {
	rl := NewRateLimiter(1.0, 3) // 1 token/sec, burst of 3

	// First 3 requests should succeed (burst)
	for i := 0; i < 3; i++ {
		if !rl.Allow("worker-a") {
			t.Errorf("request %d should be allowed (within burst)", i+1)
		}
	}
	// 4th should be denied — burst exhausted
	if rl.Allow("worker-a") {
		t.Error("request 4 should be denied (burst exhausted)")
	}
}

func TestRateLimiterRefill(t *testing.T) {
	rl := NewRateLimiter(10.0, 2) // 10 tokens/sec, burst of 2

	// Exhaust burst
	rl.Allow("worker-a")
	rl.Allow("worker-a")
	if rl.Allow("worker-a") {
		t.Error("should be denied after burst exhausted")
	}

	// Wait for refill: at 10 tokens/sec, 200ms should add ~2 tokens
	time.Sleep(250 * time.Millisecond)

	if !rl.Allow("worker-a") {
		t.Error("should be allowed after refill")
	}
}

func TestRateLimiterPerWorker(t *testing.T) {
	rl := NewRateLimiter(1.0, 2)

	// Exhaust worker-a
	rl.Allow("worker-a")
	rl.Allow("worker-a")
	if rl.Allow("worker-a") {
		t.Error("worker-a should be denied")
	}

	// worker-b should still have its own bucket
	if !rl.Allow("worker-b") {
		t.Error("worker-b should be allowed (separate bucket)")
	}
	if !rl.Allow("worker-b") {
		t.Error("worker-b second request should be allowed")
	}
	if rl.Allow("worker-b") {
		t.Error("worker-b third request should be denied")
	}
}

func TestRateLimiterCleanup(t *testing.T) {
	rl := NewRateLimiter(1.0, 5)
	rl.window = 1 * time.Millisecond // shorten cleanup window for test

	// Create some buckets
	rl.Allow("stale-worker")
	rl.Allow("fresh-worker")

	// Make "stale-worker" old by directly manipulating lastFill
	rl.mu.Lock()
	rl.buckets["stale-worker"].lastFill = time.Now().Add(-1 * time.Hour)
	rl.mu.Unlock()

	rl.Cleanup()

	rl.mu.Lock()
	_, staleExists := rl.buckets["stale-worker"]
	_, freshExists := rl.buckets["fresh-worker"]
	rl.mu.Unlock()

	if staleExists {
		t.Error("stale-worker bucket should have been cleaned up")
	}
	if !freshExists {
		t.Error("fresh-worker bucket should still exist")
	}
}

func TestRateLimiterZeroBurst(t *testing.T) {
	rl := NewRateLimiter(1.0, 0) // burst=0 means nothing can pass initially
	if rl.Allow("w") {
		t.Error("should be denied with burst=0")
	}
}

func TestRateLimiterHighRate(t *testing.T) {
	rl := NewRateLimiter(1000.0, 100) // very high rate
	for i := 0; i < 100; i++ {
		if !rl.Allow("fast-worker") {
			t.Errorf("request %d should be allowed at high rate", i+1)
		}
	}
}

func TestRateLimiterCleanupEmpty(t *testing.T) {
	rl := NewRateLimiter(1.0, 5)
	// Cleanup on empty buckets should not panic
	rl.Cleanup()

	rl.mu.Lock()
	count := len(rl.buckets)
	rl.mu.Unlock()
	if count != 0 {
		t.Errorf("buckets = %d, want 0", count)
	}
}

func TestRateLimiterTokensCappedAtBurst(t *testing.T) {
	rl := NewRateLimiter(100.0, 3)

	// Allow one request to create the bucket
	rl.Allow("w")

	// Wait to accumulate many tokens
	time.Sleep(100 * time.Millisecond)

	// Should still only allow burst (3) more requests after refill
	allowed := 0
	for i := 0; i < 10; i++ {
		if rl.Allow("w") {
			allowed++
		}
	}
	if allowed > 3 {
		t.Errorf("allowed %d, want at most burst=3", allowed)
	}
}
