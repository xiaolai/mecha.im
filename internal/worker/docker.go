package worker

import (
	"context"
	"fmt"
	"net/netip"
	"os/user"
	"strconv"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
)

type DockerClient struct {
	cli *client.Client
}

type ContainerCfg struct {
	Name      string
	Image     string
	Env       map[string]string
	Mounts    []MountCfg
	Resources ResourceConfig
	Labels    map[string]string
	User      string
}

type MountCfg struct {
	Source   string
	Target  string
	ReadOnly bool
}

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

func (d *DockerClient) Create(ctx context.Context, cfg ContainerCfg) (string, error) {
	env := make([]string, 0, len(cfg.Env))
	for k, v := range cfg.Env {
		env = append(env, k+"="+v)
	}

	port := network.MustParsePort("8080/tcp")
	portSet := network.PortSet{port: struct{}{}}
	portMap := network.PortMap{
		port: []network.PortBinding{{
			HostIP:   netip.MustParseAddr("127.0.0.1"),
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

func (d *DockerClient) Start(ctx context.Context, id string) error {
	_, err := d.cli.ContainerStart(ctx, id, client.ContainerStartOptions{})
	if err != nil {
		return fmt.Errorf("start container: %w", err)
	}
	return nil
}

func (d *DockerClient) Stop(ctx context.Context, id string, timeout time.Duration) error {
	secs := int(timeout.Seconds())
	_, err := d.cli.ContainerStop(ctx, id, client.ContainerStopOptions{Timeout: &secs})
	if err != nil {
		return fmt.Errorf("stop container: %w", err)
	}
	return nil
}

func (d *DockerClient) Remove(ctx context.Context, id string) error {
	_, err := d.cli.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: true})
	if err != nil {
		return fmt.Errorf("remove container: %w", err)
	}
	return nil
}

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
	return "http://127.0.0.1:" + bindings[0].HostPort, nil
}

func (d *DockerClient) Close() error { return d.cli.Close() }

func CurrentUser() (string, error) {
	u, err := user.Current()
	if err != nil {
		return "", fmt.Errorf("resolve current user: %w", err)
	}
	return u.Uid + ":" + u.Gid, nil
}

func ptr[T any](v T) *T { return &v }

func parseMemory(s string) (int64, error) {
	if len(s) < 2 {
		return 0, fmt.Errorf("invalid memory: %s", s)
	}
	unit := s[len(s)-1]
	num, err := strconv.ParseInt(s[:len(s)-1], 10, 64)
	if err != nil {
		return 0, err
	}
	if num <= 0 {
		return 0, fmt.Errorf("memory must be positive: %s", s)
	}
	var multiplier int64
	switch unit {
	case 'G', 'g':
		multiplier = 1024 * 1024 * 1024
	case 'M', 'm':
		multiplier = 1024 * 1024
	default:
		return 0, fmt.Errorf("unknown memory unit: %c", unit)
	}
	const maxInt64 = int64(^uint64(0) >> 1)
	if num > maxInt64/multiplier {
		return 0, fmt.Errorf("memory value overflow: %s", s)
	}
	return num * multiplier, nil
}
