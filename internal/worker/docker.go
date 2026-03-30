package worker

import (
	"context"
	"fmt"
	"net/netip"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
)

// DockerClient wraps the moby Docker client for container lifecycle operations.
// Call Close() when done.
type DockerClient struct {
	cli *client.Client
}

// ContainerCfg holds all parameters needed to create a Docker container.
type ContainerCfg struct {
	Name      string
	Image     string
	Env       map[string]string
	Mounts    []MountCfg
	Resources ResourceConfig
	Labels    map[string]string
	User      string
	Expose    bool // bind to 0.0.0.0 (network-accessible) instead of 127.0.0.1
}

// MountCfg describes a bind mount from host to container.
type MountCfg struct {
	Source   string
	Target  string
	ReadOnly bool
}

// NewDockerClient creates a Docker client. Empty host uses DOCKER_HOST env var.
func NewDockerClient(host string) (*DockerClient, error) {
	opts := []client.Opt{client.FromEnv, client.WithAPIVersionNegotiation()}
	if host != "" {
		opts = append(opts, client.WithHost(host))
	}
	cli, err := client.NewClientWithOpts(opts...)
	if err != nil {
		return nil, fmt.Errorf("create docker client: %w", err)
	}
	return &DockerClient{cli: cli}, nil
}

// Pull downloads a Docker image, waiting for completion. Returns error on failure.
func (d *DockerClient) Pull(ctx context.Context, img string) error {
	resp, err := d.cli.ImagePull(ctx, img, client.ImagePullOptions{})
	if err != nil {
		return fmt.Errorf("pull image: %w", err)
	}
	defer resp.Close()
	if err := resp.Wait(ctx); err != nil {
		return fmt.Errorf("pull image %s: %w", img, err)
	}
	return nil
}

// Create builds a container from cfg, binding port 8080 to a random localhost port.
// Returns the container ID.
func (d *DockerClient) Create(ctx context.Context, cfg ContainerCfg) (string, error) {
	env := make([]string, 0, len(cfg.Env))
	for k, v := range cfg.Env {
		env = append(env, k+"="+v)
	}

	port := network.MustParsePort("8080/tcp")
	portSet := network.PortSet{port: struct{}{}}
	hostIP := "127.0.0.1"
	if cfg.Expose {
		hostIP = "0.0.0.0"
	}
	portMap := network.PortMap{
		port: []network.PortBinding{{
			HostIP:   netip.MustParseAddr(hostIP),
			HostPort: "",
		}},
	}

	var mounts []mount.Mount
	for _, m := range cfg.Mounts {
		mounts = append(mounts, mount.Mount{
			Type:     mount.TypeBind,
			Source:   m.Source,
			Target:   m.Target,
			ReadOnly: m.ReadOnly,
		})
	}

	resources := container.Resources{}
	if cfg.Resources.CPU > 0 {
		resources.NanoCPUs = int64(cfg.Resources.CPU) * 1e9
	}
	if cfg.Resources.Memory != "" {
		if mem, err := parseMemory(cfg.Resources.Memory); err == nil {
			resources.Memory = mem
		}
	}
	if cfg.Resources.Pids > 0 {
		resources.PidsLimit = ptr(int64(cfg.Resources.Pids))
	}

	resp, err := d.cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config: &container.Config{
			Image:        cfg.Image,
			Env:          env,
			ExposedPorts: portSet,
			Labels:       cfg.Labels,
			User:         cfg.User,
		},
		HostConfig: &container.HostConfig{
			PortBindings: portMap,
			Mounts:       mounts,
			Resources:    resources,
		},
		Name: cfg.Name,
	})
	if err != nil {
		return "", fmt.Errorf("create container: %w", err)
	}
	return resp.ID, nil
}

// Start starts a created container by ID.
func (d *DockerClient) Start(ctx context.Context, id string) error {
	_, err := d.cli.ContainerStart(ctx, id, client.ContainerStartOptions{})
	if err != nil {
		return fmt.Errorf("start container: %w", err)
	}
	return nil
}

// Stop gracefully stops a container with the given timeout.
func (d *DockerClient) Stop(ctx context.Context, id string, timeout time.Duration) error {
	secs := int(timeout.Seconds())
	_, err := d.cli.ContainerStop(ctx, id, client.ContainerStopOptions{Timeout: &secs})
	if err != nil {
		return fmt.Errorf("stop container: %w", err)
	}
	return nil
}

// Remove force-removes a container by ID or name.
func (d *DockerClient) Remove(ctx context.Context, id string) error {
	_, err := d.cli.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: true})
	if err != nil {
		return fmt.Errorf("remove container: %w", err)
	}
	return nil
}

// Endpoint inspects a container and returns its mapped HTTP URL.
func (d *DockerClient) Endpoint(ctx context.Context, id string) (string, error) {
	result, err := d.cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return "", fmt.Errorf("inspect container: %w", err)
	}
	port := network.MustParsePort("8080/tcp")
	bindings, ok := result.Container.NetworkSettings.Ports[port]
	if !ok || len(bindings) == 0 {
		return "", fmt.Errorf("no port binding for 8080")
	}
	host := bindings[0].HostIP.String()
	if !bindings[0].HostIP.IsValid() || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	return "http://" + host + ":" + bindings[0].HostPort, nil
}

// Close releases the Docker client connection.
func (d *DockerClient) Close() error { return d.cli.Close() }

