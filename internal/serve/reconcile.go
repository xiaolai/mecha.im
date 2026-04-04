package serve

import (
	"context"
	"time"

	"mecha.im/internal/workers"
)

// reconcileLoop periodically checks registry state against actual Docker
// container state and fixes divergences. Runs every interval until ctx done.
func (s *Server) reconcileLoop(ctx context.Context, dock *workers.DockerClient, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			func() {
				defer func() {
					if r := recover(); r != nil {
						s.logger.Error("reconcile loop: panic", "panic", r)
					}
				}()
				s.reconcile(ctx, dock)
			}()
		}
	}
}

func (s *Server) reconcile(_ context.Context, _ *workers.DockerClient) {
	entries := s.reg.List()
	for _, e := range entries {
		if e.Worker.Docker == nil || e.ContainerID == "" {
			continue
		}
		if e.RuntimeEndpoint == "" {
			continue
		}
		err := workers.CheckHealth(e.RuntimeEndpoint, 3*time.Second)
		switch e.State {
		case workers.StateOnline:
			// Only check online workers. Busy workers are expected to return
			// 503 during task execution — health-checking them would cause
			// a permanent error state (SetOnline requires StateBusy to restore).
			if err != nil {
				cid := e.ContainerID
				if len(cid) > 12 {
					cid = cid[:12]
				}
				s.logger.Warn("reconcile: container unhealthy, setting error",
					"worker", e.Worker.Name, "container", cid)
				if setErr := s.reg.SetError(e.Worker.Name, "reconcile: container not responding"); setErr != nil {
					s.logger.Error("reconcile: set error failed", "worker", e.Worker.Name, "err", setErr)
				}
			}
		case workers.StateError:
			if err == nil {
				s.logger.Info("reconcile: container recovered",
					"worker", e.Worker.Name)
				if recErr := s.reg.Recover(e.Worker.Name); recErr != nil {
					s.logger.Error("reconcile: recover worker failed", "worker", e.Worker.Name, "err", recErr)
				}
			}
		}
	}
}
