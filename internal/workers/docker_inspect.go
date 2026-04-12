package workers

import (
	"context"
	"fmt"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/client"
)

// Ping checks if the Docker daemon is reachable. Returns the API version.
func (d *DockerClient) Ping(ctx context.Context) (string, error) {
	result, err := d.cli.Ping(ctx, client.PingOptions{})
	if err != nil {
		return "", fmt.Errorf("docker ping: %w", err)
	}
	return result.APIVersion, nil
}

// ImageExists checks if an image is available locally.
func (d *DockerClient) ImageExists(ctx context.Context, image string) (bool, error) {
	_, err := d.cli.ImageInspect(ctx, image)
	if err != nil {
		if isNotFound(err) {
			return false, nil
		}
		return false, fmt.Errorf("inspect image: %w", err)
	}
	return true, nil
}

// isNotFound checks if the error indicates a missing resource.
func isNotFound(err error) bool {
	return cerrdefs.IsNotFound(err)
}
