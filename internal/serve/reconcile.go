package serve

import (
	"context"
	"time"

	"mecha.im/internal/worker"
)

// reconcileLoop periodically checks registry state against actual Docker
// container state and fixes divergences. Runs every interval until ctx done.
func (s *Server) reconcileLoop(ctx context.Context, dock *worker.DockerClient, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.reconcile(ctx, dock)
		}
	}
}

func (s *Server) reconcile(_ context.Context, _ *worker.DockerClient) {
	entries := s.reg.List()
	for _, e := range entries {
		if e.Worker.Docker == nil || e.ContainerID == "" {
			continue
		}
		if e.RuntimeEndpoint == "" {
			continue
		}
		err := worker.CheckHealth(e.RuntimeEndpoint, 3*time.Second)
		switch e.State {
		case worker.StateOnline, worker.StateBusy:
			if err != nil {
				cid := e.ContainerID
				if len(cid) > 12 {
					cid = cid[:12]
				}
				s.logger.Warn("reconcile: container unhealthy, setting error",
					"worker", e.Worker.Name, "container", cid)
				s.reg.SetError(e.Worker.Name, "reconcile: container not responding")
			}
		case worker.StateError:
			if err == nil {
				s.logger.Info("reconcile: container recovered, setting online",
					"worker", e.Worker.Name)
				s.reg.SetOnline(e.Worker.Name)
			}
		}
	}
}
