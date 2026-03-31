---
title: Go API Reference
description: Exported types, functions, and methods in internal packages.
---

# Go API Reference

Internal Go packages for contributors and plugin developers. All packages live under `internal/` and are not importable by external modules.

## cli

CLI entry point and command registration.

| Symbol | Description |
|--------|-------------|
| `Version` | Build version, set via `-ldflags` at compile time |
| `Execute()` | Runs the root Cobra command. Calls `os.Exit(1)` on error |

## worker

Worker configuration, Docker lifecycle, registry, secrets, and health checking.

### Types

| Type | Description |
|------|-------------|
| `Worker` | Worker definition parsed from YAML. If `Docker` is non-nil, managed; if `Adapter` is non-nil, adapter; otherwise unmanaged |
| `DockerConfig` | Docker container settings (image, cwd, resources, env, token, lifecycle) |
| `AdapterConfig` | In-process LLM adapter settings (type, upstream, model, api_key) |
| `ResourceConfig` | Container CPU, memory, and PID limits |
| `EventRule` | Defines when a worker handles an event (source, on, filter, prompt) |
| `DockerClient` | Wraps the moby Docker SDK for container lifecycle operations |
| `ContainerCfg` | Parameters for creating a Docker container (name, image, env, mounts, resources) |
| `MountCfg` | Bind mount from host to container (source, target, read-only) |
| `Secrets` | Tokens loaded from `~/.mecha/secrets.yml` |
| `Registry` | Manages worker state with mutex-protected in-memory map and SQLite persistence |
| `Entry` | Combines a worker definition with its runtime state |
| `State` | Worker lifecycle state |
| `StateOffline` | Definition exists, container stopped or absent |
| `StateOnline` | Container running, health check passing |
| `StateBusy` | Executing a task (returns 429) |
| `StateError` | Health check failed or container exited |

### Worker Methods

| Method | Description |
|--------|-------------|
| `IsManaged() bool` | True if worker has a Docker section |
| `IsAdapter() bool` | True if worker uses an in-process adapter |
| `TypeLabel() string` | Returns `"managed"`, `"adapter"`, or `"live"` |

### EventRule Methods

| Method | Description |
|--------|-------------|
| `IsAuto() bool` | Whether this rule dispatches automatically (default: true) |

### Config Functions

| Function | Description |
|----------|-------------|
| `LoadFile(path) (*Worker, error)` | Read YAML, interpolate env vars, validate, apply defaults |
| `LoadDir(dir) ([]*Worker, error)` | Load all `.yml`/`.yaml` files in a directory |

### Validation

| Function | Description |
|----------|-------------|
| `DockerConfig.Validate() error` | Checks image required, lifecycle values, expose/api_key coupling, cwd path safety, resource specs |
| `AdapterConfig.Validate() error` | Checks type is `ollama` or `openai`, upstream and model required |
| `IsSensitivePath(absPath) bool` | Reports whether a path is a protected system or credential path (`/etc`, `~/.ssh`, etc.) |

### Docker Client

| Method | Description |
|--------|-------------|
| `NewDockerClient(host) (*DockerClient, error)` | Create client. Empty host uses `DOCKER_HOST` env var |
| `Pull(ctx, image) error` | Download a Docker image |
| `Create(ctx, cfg) (containerID, error)` | Build and create a container |
| `Start(ctx, id) error` | Start a created container |
| `Stop(ctx, id, timeout) error` | Gracefully stop a container |
| `Remove(ctx, id) error` | Force-remove a container |
| `Endpoint(ctx, id) (url, error)` | Inspect container and return its mapped HTTP URL |
| `Ping(ctx) (apiVersion, error)` | Check if Docker daemon is reachable |
| `ImageExists(ctx, image) (bool, error)` | Check if an image is available locally |
| `Close() error` | Release the Docker client connection |

### Container Assembly

| Function | Description |
|----------|-------------|
| `BuildContainerEnv(dc, validate) (map, error)` | Assemble env vars: resolve token from secrets, merge `docker.env`, set HOME |
| `BuildContainerMounts(dc) ([]MountCfg, error)` | Resolve `docker.cwd` into a bind mount at `/workspace` |
| `CurrentUser() (string, error)` | Returns `"uid:gid"` for the container `--user` flag |

### Registry

| Method | Description |
|--------|-------------|
| `NewRegistry(db) (*Registry, error)` | Create registry backed by SQLite. Loads existing workers |
| `Add(w) error` | Register a new worker in offline state |
| `Remove(name) error` | Delete a worker (must be offline) |
| `Start(name) error` | Transition offline to online (unmanaged workers) |
| `Stop(name) error` | Transition online/error to offline |
| `Get(name) (Entry, bool)` | Return a deep copy of the named entry |
| `List() []Entry` | Return deep copies of all entries sorted by name |
| `Reload() error` | Re-read all workers from SQLite into the in-memory cache |
| `SetRuntime(name, containerID, endpoint) error` | Record container runtime info, transition to online |
| `StopRuntime(name) error` | Transition to offline, clear endpoint (keep container ID) |
| `ClearRuntime(name) error` | Transition to offline, clear all runtime fields |
| `SetBusy(name) error` | Transition online to busy (task dispatched) |
| `SetOnline(name) error` | Transition busy to online (task completed) |
| `SetError(name, errMsg) error` | Transition to error state with redacted message |

### Secrets

| Function | Description |
|----------|-------------|
| `LoadSecrets(path) (*Secrets, error)` | Read YAML secrets file. Returns empty for missing file. Errors on bad permissions (want 0600) |
| `DefaultSecretsPath() (string, error)` | Returns `~/.mecha/secrets.yml` |
| `Resolve(ref) (string, error)` | Look up token by `"backend.name"` reference (e.g. `"claude.xiaolaidev"`) |
| `DetectTokenEnvVar(token) (envKey, token)` | Map token value to env var name by prefix (`sk-ant-oat` -> `CLAUDE_CODE_OAUTH_TOKEN`, etc.) |

### Health & Redaction

| Function | Description |
|----------|-------------|
| `CheckHealth(endpoint, timeout) error` | Send `GET <endpoint>/health`, return nil on HTTP 200 |
| `RedactSecrets(s) string` | Replace known credential patterns with `[REDACTED]` (13 patterns) |

## event

Event types and SQLite persistence.

### Types

| Type | Description |
|------|-------------|
| `Event` | Something that happened from an external source (webhook payload) |
| `Payload` | Map of enriched fields available to prompt templates |
| `State` | Event lifecycle state |
| `Store` | Manages event persistence in SQLite |

### State Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `StateReceived` | `"received"` | Event arrived, not yet matched |
| `StateMatched` | `"matched"` | Matched to a worker by event rules |
| `StateDispatched` | `"dispatched"` | Task created and sent to worker |
| `StateCompleted` | `"completed"` | Worker returned a result |
| `StateFailed` | `"failed"` | Processing errored or timed out |
| `StateSkipped` | `"skipped"` | No matching worker found |

### Store Methods

| Method | Description |
|--------|-------------|
| `NewStore(db) *Store` | Create an event store |
| `Create(ctx, ev) error` | Persist a new event in received state |
| `Get(ctx, id) (*Event, error)` | Retrieve an event by ID |
| `List(ctx, state) ([]Event, error)` | List events, optionally filtered by state |
| `DeliveryExists(ctx, deliveryID) (bool, error)` | Check if a delivery ID has been processed (dedup) |
| `SetMatched(ctx, id, workerName) error` | Transition received -> matched |
| `SetDispatched(ctx, id, taskID) error` | Transition matched -> dispatched |
| `SetCompleted(ctx, id) error` | Transition dispatched -> completed |
| `SetFailed(ctx, id) error` | Mark as failed from any active state |
| `SetSkipped(ctx, id) error` | Transition received -> skipped |

## task

Task types and SQLite persistence.

### Types

| Type | Description |
|------|-------------|
| `Task` | A unit of work sent to a worker |
| `State` | Task lifecycle state |
| `Store` | Manages task persistence in SQLite |

### State Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `StatePending` | `"pending"` | Queued but not yet sent |
| `StateDispatched` | `"dispatched"` | Sent to a worker |
| `StateCompleted` | `"completed"` | Worker returned a result |
| `StateFailed` | `"failed"` | Errored or timed out |

### Store Methods

| Method | Description |
|--------|-------------|
| `NewStore(db) *Store` | Create a task store |
| `Create(ctx, workerName, prompt) (*Task, error)` | Insert a task in pending state |
| `CreateWithEvent(ctx, workerName, prompt, context, eventID) (*Task, error)` | Insert a task with event context |
| `Get(ctx, id) (*Task, error)` | Retrieve a task by ID |
| `List(ctx, state) ([]Task, error)` | List tasks, optionally filtered by state |
| `SetDispatched(ctx, id) error` | Mark as dispatched |
| `Complete(ctx, id, result) error` | Mark as completed with result |
| `Fail(ctx, id, errMsg) error` | Mark as failed with error |
| `Pending(ctx) ([]string, error)` | Return IDs of pending/dispatched tasks (for recovery) |

## policy

Policy filtering for write-back results.

### Types

| Type | Description |
|------|-------------|
| `Result` | Shared worker result contract (output, comment, labels, status, commit) |
| `CommentAction` | Posts a comment to a PR or issue |
| `LabelAction` | Adds or removes labels |
| `StatusAction` | Sets a commit status |
| `CommitAction` | Suggests code changes |
| `Filter` | Interface for policy filters (`Apply` method) |
| `RuleFilter` | Per-worker policy rules parsed from YAML |
| `DenyAll` | Blocks all write-back actions (used for invalid policy config) |
| `AllowAll` | Passes everything through (used when no policy is configured) |
| `CommentPolicy` | Controls comment write-back (allow, max_length) |
| `LabelPolicy` | Controls label write-back (allow, blocked list) |
| `StatusPolicy` | Controls commit status write-back (allow) |
| `CommitPolicy` | Controls code change suggestions (allow) |
| `Decision` | Records what the policy allowed and denied |

### Functions

| Function | Description |
|----------|-------------|
| `ParseRules(raw) (Filter, error)` | Convert a raw YAML map into a `RuleFilter`. Returns `AllowAll` if empty |
| `RuleFilter.Apply(ctx, ev, result) (Result, Decision, error)` | Filter result according to configured rules |
| `DenyAll.Apply(ctx, ev, result) (Result, Decision, error)` | Returns empty result with all actions denied |

## source

Webhook source parsing (GitHub, GitLab, generic).

### Types

| Type | Description |
|------|-------------|
| `Source` | Interface: parses incoming webhooks into normalized events |
| `Hydrator` | Interface: enriches events with additional data (e.g. fetching diffs) |
| `Registry` | Holds registered event sources by name |
| `GitHubSource` | Parses GitHub webhook payloads. Validates HMAC signatures |
| `GitLabSource` | Parses GitLab webhook payloads. Validates X-Gitlab-Token |
| `GenericSource` | Parses arbitrary JSON webhooks. Event type from configurable header |

### Functions

| Function | Description |
|----------|-------------|
| `NewRegistry() *Registry` | Create an empty source registry |
| `Register(s Source)` | Add a source to the registry |
| `Get(name) (Source, bool)` | Look up a source by name |
| `Len() int` | Number of registered sources |
| `NewGitHubSource(secret, token) *GitHubSource` | Create GitHub webhook source |
| `NewGitLabSource(secret) *GitLabSource` | Create GitLab webhook source |
| `NewGenericSource(name, typeHeader) *GenericSource` | Create generic webhook source |
| `Hydrate(ctx, ev) error` | Enrich a GitHub event with diff and file data |

## adapter

In-process LLM adapters translating native APIs to the worker contract.

### Types

| Type | Description |
|------|-------------|
| `Adapter` | Interface: `Name()`, `Health(ctx)`, `SendTask(ctx, prompt)` |
| `Runner` | Wraps an Adapter with an HTTP server (`GET /health`, `POST /task`) |
| `OllamaAdapter` | Translates Ollama `/api/chat` into the worker contract |
| `OpenAIAdapter` | Translates OpenAI-compatible `/v1/chat/completions` into the worker contract |

### Functions

| Function | Description |
|----------|-------------|
| `NewRunner(adapter, logger) (*Runner, error)` | Create a runner listening on a random localhost port |
| `Runner.Start()` | Begin serving (non-blocking) |
| `Runner.Stop(ctx) error` | Shutdown the HTTP server gracefully |
| `Runner.Endpoint() string` | Return the HTTP URL the runner listens on |
| `NewOllamaAdapter(upstream, model) *OllamaAdapter` | Create adapter for a running Ollama instance |
| `NewOpenAIAdapter(upstream, model, apiKey) *OpenAIAdapter` | Create adapter for an OpenAI-compatible endpoint |

## serve

HTTP server, webhook dispatch, and task management.

### Types

| Type | Description |
|------|-------------|
| `Server` | HTTP daemon that accepts tasks and dispatches to workers |
| `Config` | Server startup parameters (registry, stores, sources, addr, api key) |

### Functions

| Function | Description |
|----------|-------------|
| `New(cfg Config) *Server` | Create a server (does not start it) |
| `Start(ctx) error` | Begin serving HTTP and the dispatch loop. Blocks until ctx is cancelled |

## store

SQLite database management.

### Functions

| Function | Description |
|----------|-------------|
| `Open(path) (*sql.DB, error)` | Create or open a SQLite database with WAL mode and versioned migrations |
| `DefaultDBPath() (string, error)` | Returns `~/.mecha/mecha.db` |

## writeback

GitHub write-back integration.

### Types

| Type | Description |
|------|-------------|
| `Client` | Writes task results back to GitHub (comments, labels, status, commit suggestions) |

### Functions

| Function | Description |
|----------|-------------|
| `NewClient(token, logger) *Client` | Create a write-back client |
| `WriteBackResult(ctx, event, result) error` | Write a policy-filtered result to GitHub |
| `OverrideAPIBase(url) func()` | Test utility: replace GitHub API base URL, returns restore function |
