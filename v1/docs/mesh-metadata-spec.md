# Mesh Session Metadata — Implementation Spec

> Enable shared session metadata across a mesh network mesh so any machine
> running mecha CLI or dashboard can read, star, rename, and delete sessions
> on any node's mechas.

## Status: Draft

## Terminology

| Term | Definition |
|---|---|
| **Node** | A machine in the mesh network tailnet running `mecha agent` |
| **MechaRef** | `{ node: string, id: string }` — mesh-scoped mecha identity |
| **Host node** | The node whose Docker daemon owns a mecha container |
| **Viewer** | The machine running CLI or dashboard that issues commands |
| **Agent** | The Fastify HTTP server (`packages/agent`) running on a node |
| **Session metadata** | Stars and custom titles stored in `~/.mecha/session-meta.json` |

---

## Phase 0 — Identity & Contracts

### Problem

Mecha IDs (`mx-<slug>-<hash>`) are derived from the project path. Two nodes
with the same path produce the same ID. The store, cache, and routing all
key by bare `id`, causing collisions in a multi-node mesh.

### Spec

#### 0.1 — `MechaRef` type (packages/core)

**File:** `packages/core/src/types.ts`

```typescript
/** Mesh-scoped mecha reference. */
export interface MechaRef {
  /** Node name: "local" for the current machine, or a registered node name. */
  node: string;
  /** Mecha ID on that node (e.g. "mx-myproject-abc123"). */
  id: string;
}

/** Serialize a MechaRef to a single string key: "node/id" or just "id" for local. */
export function mechaRefKey(ref: MechaRef): string {
  return ref.node === "local" ? ref.id : `${ref.node}/${ref.id}`;
}

/** Parse a MechaRef key back. Bare "mx-foo-abc" → { node: "local", id }. */
export function parseMechaRefKey(key: string): MechaRef {
  const slash = key.indexOf("/");
  if (slash === -1) return { node: "local", id: key };
  return { node: key.slice(0, slash), id: key.slice(slash + 1) };
}
```

**Tests:** `packages/core/__tests__/mecha-ref.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `mechaRefKey({ node: "local", id: "mx-foo-abc" })` | returns `"mx-foo-abc"` |
| 2 | `mechaRefKey({ node: "gpu-server", id: "mx-foo-abc" })` | returns `"gpu-server/mx-foo-abc"` |
| 3 | `parseMechaRefKey("mx-foo-abc")` | returns `{ node: "local", id: "mx-foo-abc" }` |
| 4 | `parseMechaRefKey("gpu-server/mx-foo-abc")` | returns `{ node: "gpu-server", id: "mx-foo-abc" }` |
| 5 | round-trip: `parseMechaRefKey(mechaRefKey(ref))` equals `ref` | for both local and remote refs |
| 6 | node name with no `/` in mecha ID doesn't collide | `parseMechaRefKey("work/mx-a-b")` → `{ node: "work", id: "mx-a-b" }` |

#### 0.2 — Remote error codes (packages/contracts)

**File:** `packages/contracts/src/errors.ts`

Add new error classes alongside existing ones:

```typescript
export class NodeUnreachableError extends MechaError {
  constructor(node: string) {
    super(`Node unreachable: ${node}`, "NODE_UNREACHABLE");
  }
}

export class NodeAuthFailedError extends MechaError {
  constructor(node: string) {
    super(`Authentication failed for node: ${node}`, "NODE_AUTH_FAILED");
  }
}

export class NodeRequestFailedError extends MechaError {
  constructor(node: string, status: number, body: string) {
    super(`Request to node ${node} failed: ${status} ${body}`, "NODE_REQUEST_FAILED");
  }
}

export class MechaNotLocatedError extends MechaError {
  constructor(id: string) {
    super(`Mecha ${id} not found on any node`, "MECHA_NOT_LOCATED");
  }
}
```

Add to `HTTP_STATUS_MAP`:

```typescript
NODE_UNREACHABLE: 502,
NODE_AUTH_FAILED: 502,
NODE_REQUEST_FAILED: 502,
MECHA_NOT_LOCATED: 404,
```

**Tests:** `packages/contracts/__tests__/errors.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `toHttpStatus(new NodeUnreachableError("x"))` | returns `502` |
| 2 | `toHttpStatus(new NodeAuthFailedError("x"))` | returns `502` |
| 3 | `toHttpStatus(new NodeRequestFailedError("x", 500, ""))` | returns `502` |
| 4 | `toHttpStatus(new MechaNotLocatedError("mx-a"))` | returns `404` |
| 5 | `toUserMessage(new NodeUnreachableError("gpu"))` | contains `"gpu"` |
| 6 | `toSafeMessage(new NodeUnreachableError("gpu"))` | contains `"Node unreachable"` |

#### 0.3 — `SessionMetaUpdate` schema (packages/contracts)

**File:** `packages/contracts/src/schemas.ts`

```typescript
export const SessionMetaUpdate = z.object({
  customTitle: z.string().min(1).max(200).optional(),
  starred: z.boolean().optional(),
}).refine(
  (d) => d.customTitle !== undefined || d.starred !== undefined,
  { message: "At least one of customTitle or starred is required" },
);
export type SessionMetaUpdate = z.infer<typeof SessionMetaUpdate>;
```

**Tests:** `packages/contracts/__tests__/schemas.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `SessionMetaUpdate.parse({ starred: true })` | succeeds |
| 2 | `SessionMetaUpdate.parse({ customTitle: "x" })` | succeeds |
| 3 | `SessionMetaUpdate.parse({ customTitle: "x", starred: false })` | succeeds |
| 4 | `SessionMetaUpdate.parse({})` | throws ZodError |
| 5 | `SessionMetaUpdate.parse({ customTitle: "" })` | throws (min 1) |
| 6 | `SessionMetaUpdate.parse({ customTitle: "a".repeat(201) })` | throws (max 200) |

#### 0.4 — Metadata cleanup on delete (packages/core)

**File:** `packages/core/src/session-meta.ts`

Add:

```typescript
/** Remove all metadata for a specific session. */
export function deleteSessionMeta(mechaId: string, sessionId: string): void {
  const store = readStore();
  if (!store[mechaId]?.[sessionId]) return; // nothing to delete
  delete store[mechaId][sessionId];
  if (Object.keys(store[mechaId]).length === 0) delete store[mechaId];
  writeStore(store);
}
```

**Tests:** `packages/core/__tests__/session-meta.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `deleteSessionMeta` removes the entry from disk | re-read returns `{}` |
| 2 | `deleteSessionMeta` cleans up empty mecha branch | mecha key no longer in store |
| 3 | `deleteSessionMeta` is no-op for nonexistent session | no error, file unchanged |
| 4 | `deleteSessionMeta` preserves other sessions' metadata | sibling entry still present |

#### 0.5 — Wire delete cleanup into service

**File:** `packages/service/src/sessions.ts` — `mechaSessionDelete`

After `unlinkSync(match.filePath)`, add:

```typescript
deleteSessionMeta(input.id, input.sessionId);
```

**Tests:** `packages/service/__tests__/service-new.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `mechaSessionDelete` calls `deleteSessionMeta` after unlink | mock verified |
| 2 | delete still succeeds if `deleteSessionMeta` throws | graceful fallback |

---

## Phase 1 — Agent Session Meta Routes

### Problem

The agent server has no routes for metadata writes or session deletion. Remote
viewers cannot star/rename/delete sessions.

### Spec

#### 1.1 — PATCH `/mechas/:id/sessions/:sessionId/meta`

**File:** `packages/agent/src/routes/sessions.ts`

```
Request:  PATCH /mechas/:id/sessions/:sessionId/meta
Headers:  Authorization: Bearer <apiKey>
Body:     { customTitle?: string, starred?: boolean }
Response: 200 { ok: true }
Errors:   400 (validation), 404 (session not found)
```

Implementation:
1. Parse body with `SessionMetaUpdate` schema
2. Call `setSessionMeta(id, sessionId, parsed)`
3. Return `{ ok: true }`

**Tests:** `packages/agent/__tests__/routes/sessions.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | PATCH with `{ starred: true }` → 200 | `setSessionMeta` called with correct args |
| 2 | PATCH with `{ customTitle: "foo" }` → 200 | `setSessionMeta` called |
| 3 | PATCH with `{}` → 400 | validation error (no fields) |
| 4 | PATCH with `{ customTitle: "" }` → 400 | validation error (min 1) |
| 5 | PATCH without auth → 401 | bearer auth enforced |
| 6 | PATCH with wrong auth → 401 | bearer auth enforced |

#### 1.2 — DELETE `/mechas/:id/sessions/:sessionId`

**File:** `packages/agent/src/routes/sessions.ts`

```
Request:  DELETE /mechas/:id/sessions/:sessionId
Headers:  Authorization: Bearer <apiKey>
Response: 204
Errors:   404 (session not found)
```

Implementation:
1. Call `mechaSessionDelete(docker, { id, sessionId })`
2. Return 204

**Tests:** `packages/agent/__tests__/routes/sessions.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | DELETE existing session → 204 | `mechaSessionDelete` called |
| 2 | DELETE nonexistent session → 404 | `SessionNotFoundError` mapped |
| 3 | DELETE without auth → 401 | bearer auth enforced |

#### 1.3 — GET `/mechas/:id/sessions/:sessionId`

**File:** `packages/agent/src/routes/sessions.ts`

```
Request:  GET /mechas/:id/sessions/:sessionId
Headers:  Authorization: Bearer <apiKey>
Response: 200 ParsedSession (JSON)
Errors:   404 (session not found)
```

Implementation:
1. Call `mechaSessionGet(docker, { id, sessionId })`
2. Return result (auto-serialized by Fastify)

**Tests:**

| # | Test | Assertion |
|---|---|---|
| 1 | GET existing session → 200 with ParsedSession shape | id, messages, projectSlug present |
| 2 | GET nonexistent → 404 | `SessionNotFoundError` mapped |
| 3 | GET without auth → 401 | enforced |

---

## Phase 2 — Service Layer: Node-Aware Dispatch

### Problem

Service functions only operate on the local Docker daemon. There is no way
to dispatch an operation to a remote agent.

### Spec

#### 2.1 — `agentFetch` utility (packages/service)

**File:** `packages/service/src/agent-client.ts`

A typed HTTP client for calling remote agent endpoints.

```typescript
import type { NodeEntry } from "@mecha/agent";
import {
  NodeUnreachableError,
  NodeAuthFailedError,
  NodeRequestFailedError,
} from "@mecha/contracts";

export interface AgentFetchOptions extends Omit<RequestInit, "signal"> {
  timeoutMs?: number;  // default: 10_000
}

/**
 * Fetch from a remote agent node.
 * Throws domain errors for network/auth/request failures.
 */
export async function agentFetch(
  node: NodeEntry,
  path: string,
  opts: AgentFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 10_000, ...init } = opts;
  const base = node.host.startsWith("http") ? node.host : `http://${node.host}`;
  const url = `${base}${path}`;
  const headers = new Headers(init.headers as Record<string, string>);
  headers.set("Authorization", `Bearer ${node.key}`);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new NodeUnreachableError(node.name);
  }
  if (res.status === 401) throw new NodeAuthFailedError(node.name);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new NodeRequestFailedError(node.name, res.status, body);
  }
  return res;
}
```

**Tests:** `packages/service/__tests__/agent-client.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Successful GET returns Response | `res.ok === true` |
| 2 | Sets Authorization header | mock verifies header |
| 3 | Network error → `NodeUnreachableError` | error code = `NODE_UNREACHABLE` |
| 4 | 401 response → `NodeAuthFailedError` | error code = `NODE_AUTH_FAILED` |
| 5 | 500 response → `NodeRequestFailedError` | error code = `NODE_REQUEST_FAILED`, contains status |
| 6 | Timeout → `NodeUnreachableError` | fetch aborted after `timeoutMs` |
| 7 | Host without `http://` prefix → auto-adds it | URL constructed correctly |
| 8 | Caller-provided headers are preserved alongside auth | both present |

#### 2.2 — `MechaLocator` (packages/service)

**File:** `packages/service/src/locator.ts`

Resolves which node owns a mecha ID.

```typescript
import type { DockerClient } from "@mecha/docker";
import type { NodeEntry } from "@mecha/agent";
import type { MechaRef } from "@mecha/core";
import { MechaNotLocatedError } from "@mecha/contracts";
import { mechaLs } from "./inspect.js";
import { agentFetch } from "./agent-client.js";

export interface LocatorOptions {
  /** TTL for cache entries in ms. Default: 30_000 (30s). */
  cacheTtlMs?: number;
}

interface CacheEntry {
  node: string;
  host: string;
  key: string;
  expiresAt: number;
}

export class MechaLocator {
  private cache = new Map<string, CacheEntry>();
  private ttl: number;

  constructor(opts: LocatorOptions = {}) {
    this.ttl = opts.cacheTtlMs ?? 30_000;
  }

  /** Resolve a mecha ID to a MechaRef + connection info. */
  async locate(
    client: DockerClient,
    mechaId: string,
    nodes: NodeEntry[],
  ): Promise<MechaRef & { entry?: NodeEntry }> {
    // 1. Check cache (if not expired)
    // 2. Check local Docker
    // 3. Query each remote node's GET /mechas
    // 4. Cache the result
    // 5. Throw MechaNotLocatedError if not found anywhere
  }

  /** Invalidate a specific mecha from cache (call on 404/failure). */
  invalidate(mechaId: string): void {
    this.cache.delete(mechaId);
  }

  /** Clear all cache entries. */
  clear(): void {
    this.cache.clear();
  }
}
```

**Tests:** `packages/service/__tests__/locator.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Local mecha found → returns `{ node: "local", id }` | no remote calls made |
| 2 | Remote mecha found → returns `{ node: name, id, entry }` | correct node entry |
| 3 | Not found anywhere → throws `MechaNotLocatedError` | error code correct |
| 4 | Cached result returned within TTL | no Docker/fetch calls on second lookup |
| 5 | Expired cache entry triggers re-lookup | fresh call made |
| 6 | `invalidate(id)` forces re-lookup | cache miss on next call |
| 7 | Local preferred over remote when ID exists in both | returns `{ node: "local" }` |
| 8 | Remote node unreachable during scan → skipped | other nodes still checked |
| 9 | `clear()` empties all entries | subsequent lookups re-query |

#### 2.3 — Node-aware session functions (packages/service)

**File:** `packages/service/src/remote-sessions.ts`

Thin wrappers that dispatch local vs remote based on `MechaRef`.

```typescript
import type { DockerClient } from "@mecha/docker";
import type { NodeEntry } from "@mecha/agent";
import type { SessionSummary, ParsedSession, SessionMeta } from "@mecha/core";
import type { SessionListResult } from "./sessions.js";
import { mechaSessionList, mechaSessionGet, mechaSessionDelete } from "./sessions.js";
import { agentFetch } from "./agent-client.js";

export async function remoteSessionList(
  client: DockerClient,
  mechaId: string,
  target: { node: string; entry?: NodeEntry },
): Promise<SessionListResult> {
  if (target.node === "local") {
    return mechaSessionList(client, { id: mechaId });
  }
  const res = await agentFetch(target.entry!, `/mechas/${mechaId}/sessions`);
  return res.json() as Promise<SessionListResult>;
}

export async function remoteSessionGet(
  client: DockerClient,
  mechaId: string,
  sessionId: string,
  target: { node: string; entry?: NodeEntry },
): Promise<ParsedSession> {
  if (target.node === "local") {
    return mechaSessionGet(client, { id: mechaId, sessionId });
  }
  const sid = encodeURIComponent(sessionId);
  const res = await agentFetch(target.entry!, `/mechas/${mechaId}/sessions/${sid}`);
  return res.json() as Promise<ParsedSession>;
}

export async function remoteSessionMetaUpdate(
  mechaId: string,
  sessionId: string,
  meta: { customTitle?: string; starred?: boolean },
  target: { node: string; entry?: NodeEntry },
): Promise<void> {
  if (target.node === "local") {
    const { setSessionMeta } = await import("@mecha/core");
    setSessionMeta(mechaId, sessionId, meta);
    return;
  }
  const sid = encodeURIComponent(sessionId);
  await agentFetch(target.entry!, `/mechas/${mechaId}/sessions/${sid}/meta`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
}

export async function remoteSessionDelete(
  client: DockerClient,
  mechaId: string,
  sessionId: string,
  target: { node: string; entry?: NodeEntry },
): Promise<void> {
  if (target.node === "local") {
    return mechaSessionDelete(client, { id: mechaId, sessionId });
  }
  const sid = encodeURIComponent(sessionId);
  await agentFetch(target.entry!, `/mechas/${mechaId}/sessions/${sid}`, {
    method: "DELETE",
  });
}
```

**Tests:** `packages/service/__tests__/remote-sessions.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `remoteSessionList` with local target → calls `mechaSessionList` | no fetch |
| 2 | `remoteSessionList` with remote target → calls `agentFetch` | correct URL |
| 3 | `remoteSessionGet` with local → calls `mechaSessionGet` | correct args |
| 4 | `remoteSessionGet` with remote → calls `agentFetch` | URL includes session ID |
| 5 | `remoteSessionMetaUpdate` local → calls `setSessionMeta` | correct args |
| 6 | `remoteSessionMetaUpdate` remote → PATCHes agent | body is JSON meta |
| 7 | `remoteSessionDelete` local → calls `mechaSessionDelete` | unlinks file |
| 8 | `remoteSessionDelete` remote → DELETEs via agent | correct URL and method |
| 9 | Session ID with special chars is URL-encoded | `encodeURIComponent` applied |

---

## Phase 3 — CLI `--node` Flag

### Problem

CLI session commands only work on local mechas. No way to target a remote node.

### Spec

#### 3.1 — Shared `--node` option + resolver (packages/cli)

**File:** `packages/cli/src/commands/shared-options.ts`

```typescript
import type { Command } from "commander";

/** Add --node <name> option to a command. */
export function withNodeOption(cmd: Command): Command {
  return cmd.option(
    "--node <name>",
    "Target a specific remote node (default: auto-detect local then remote)",
  );
}
```

**File:** `packages/cli/src/commands/resolve-target.ts`

```typescript
import type { DockerClient } from "@mecha/docker";
import type { NodeEntry } from "@mecha/agent";
import { MechaLocator } from "@mecha/service";
import type { MechaRef } from "@mecha/core";

/**
 * Resolve a mecha target from CLI args.
 * If --node is given, skip auto-detection and use that node directly.
 * If --node is omitted, use MechaLocator to auto-detect.
 */
export async function resolveTarget(
  client: DockerClient,
  mechaId: string,
  nodeFlag: string | undefined,
): Promise<MechaRef & { entry?: NodeEntry }> { ... }
```

**Tests:** `packages/cli/__tests__/commands/resolve-target.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `--node gpu` → returns `{ node: "gpu", id, entry }` | reads from nodes.json |
| 2 | No `--node`, local mecha exists → returns `{ node: "local", id }` | no remote calls |
| 3 | No `--node`, only remote → returns remote ref | locator queried |
| 4 | No `--node`, not found → throws `MechaNotLocatedError` | exit code 1 |
| 5 | `--node nonexistent` → throws error | node not in registry |

#### 3.2 — `sessions list` with `--node`

**Modify:** `packages/cli/src/commands/sessions.ts`

- Add `--node` option to `sessions list <id>`
- If `--node` provided, resolve target, call `remoteSessionList`
- If not provided, call local `mechaSessionList` (backward compatible)

**Tests:** `packages/cli/__tests__/commands/sessions.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `sessions list mx-test --node gpu` → calls `remoteSessionList` with remote target | table output with sessions |
| 2 | `sessions list mx-test` (no flag) → calls local path | backward compatible |
| 3 | `sessions list mx-test --node bad` → error | node not found |

#### 3.3 — `sessions show` with `--node`

Same pattern. Add `--node`, dispatch via `remoteSessionGet`.

**Tests:**

| # | Test | Assertion |
|---|---|---|
| 1 | `sessions show mx-test sess-abc --node gpu` → calls remote | session detail displayed |
| 2 | `sessions show mx-test sess-abc` → local | backward compatible |

#### 3.4 — `sessions star` command (new)

**Modify:** `packages/cli/src/commands/sessions.ts`

```
mecha sessions star <id> <sessionId> [--node <name>]
```

Toggles the `starred` field via `remoteSessionMetaUpdate`.

**Tests:**

| # | Test | Assertion |
|---|---|---|
| 1 | `sessions star mx-test sess-1` → calls `setSessionMeta` with `starred: true` | success message |
| 2 | `sessions star mx-test sess-1 --node gpu` → PATCHes agent | success message |
| 3 | Already starred → sets `starred: false` (toggle) | service called with false |

#### 3.5 — `sessions rename` with `--node`

Current `sessions rename` calls `mechaSessionRename` which writes local metadata.
Add `--node` support to route through `remoteSessionMetaUpdate`.

**Tests:**

| # | Test | Assertion |
|---|---|---|
| 1 | `sessions rename mx-test sess-1 "Title" --node gpu` → PATCHes agent | success message |
| 2 | `sessions rename mx-test sess-1 "Title"` → local | backward compatible |

#### 3.6 — `sessions delete` with `--node`

**Tests:**

| # | Test | Assertion |
|---|---|---|
| 1 | `sessions delete mx-test sess-1 --node gpu` → DELETEs via agent | success |
| 2 | `sessions delete mx-test sess-1` → local | backward compatible |

---

## Phase 4 — Dashboard Node-Aware Routing

### Problem

Dashboard writes metadata locally even for remote mechas (the bug Codex found
at `route.ts:59`). Session panel doesn't route through agents for remote mechas.

### Spec

#### 4.1 — Dashboard store key migration

**File:** `packages/dashboard/src/lib/store.ts`

Change `sessions` key from `Record<mechaId, Session[]>` to
`Record<refKey, Session[]>` where `refKey = mechaRefKey({ node, id })`.

Add `node` field to the `Session` interface:

```typescript
export interface Session {
  id: string;
  node: string;      // "local" or node name
  projectSlug: string;
  // ... rest unchanged
}
```

**Tests:** `packages/dashboard/__tests__/store.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Local sessions keyed as `"mx-foo"` | backward compatible |
| 2 | Remote sessions keyed as `"gpu/mx-foo"` | separate namespace |
| 3 | `setSessions("gpu/mx-foo", [...])` and `setSessions("mx-foo", [...])` coexist | no collision |

#### 4.2 — Node-aware API proxy

**File:** `packages/dashboard/src/app/api/mechas/[id]/sessions/route.ts`

On `GET`, determine if mecha is local or remote:
- Local → call `mechaSessionList` directly (current behavior)
- Remote → `agentFetch(node, GET /mechas/:id/sessions)` and proxy response

**File:** `packages/dashboard/src/app/api/mechas/[id]/sessions/[sessionId]/route.ts`

On `GET`, `PATCH`, `DELETE`:
- Local → current code path
- Remote → proxy to agent

The `node` is passed as a query parameter: `?node=gpu-server` or determined
from the store's mecha list.

**Tests:** `packages/dashboard/__tests__/api/sessions-route.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | GET local session → calls `mechaSessionGet` | 200 with ParsedSession |
| 2 | GET remote session → proxies to agent | `agentFetch` called |
| 3 | PATCH local session → calls `setSessionMeta` locally | 200 |
| 4 | PATCH remote session → proxies PATCH to agent | not written locally |
| 5 | DELETE local → `mechaSessionDelete` + `deleteSessionMeta` | 204 |
| 6 | DELETE remote → proxies DELETE to agent | no local file ops |

#### 4.3 — SSE relay for remote `sessionMessage`

**File:** `packages/dashboard/src/app/api/mechas/[id]/sessions/[sessionId]/message/route.ts`

For remote mechas, the SSE chain is:

```
Browser → Dashboard POST /api/mechas/:id/sessions/:sid/message?node=gpu
  → agentFetch(node, POST /mechas/:id/sessions/:sid/message, { body, stream })
  → Agent relays to container runtime
  → SSE piped back through each hop
```

Implementation notes:
- Use `agentFetch` without the default timeout (SSE streams are long-lived)
- Pipe `res.body` (ReadableStream) directly to `NextResponse`
- Propagate `req.signal` (AbortSignal) for client disconnect

**Tests:** (integration-level, not unit)

| # | Test | Assertion |
|---|---|---|
| 1 | SSE stream from remote agent is relayed to client | event data arrives |
| 2 | Client disconnect aborts upstream fetch | agent reader cancelled |
| 3 | Agent unreachable → 502 | `NodeUnreachableError` mapped |

---

## Phase 5 — Migration & Reconciliation (Future)

Out of scope for initial implementation. Tracked here for completeness.

- `mecha meta export <id>` → dumps session-meta.json entries for a mecha
- `mecha meta import <id> < file` → merges metadata from another node
- Orphan metadata cleanup on `sessions list` (metadata entries with no JSONL file)
- Auth scope system (read/write/admin tokens per agent)

---

## Quality Gates

Every work item must pass before proceeding to the next:

```
pnpm test                # all tests pass
pnpm test:coverage       # 100% coverage gates
pnpm typecheck           # zero type errors
pnpm build               # clean build
```

## TDD Protocol

For each work item:

1. **Write the test file first** — all tests fail (red)
2. **Write minimum implementation** — tests pass (green)
3. **Refactor** — clean up while tests stay green
4. **Verify gates** — run all four quality checks
5. **Commit** — one commit per work item

No implementation code is written before its test exists.

---

## Dependency Graph

```
Phase 0.1 (MechaRef)
Phase 0.2 (Error codes)
Phase 0.3 (SessionMetaUpdate schema)
Phase 0.4 (deleteSessionMeta)
  └→ Phase 0.5 (wire into service delete)
       └→ Phase 1.2 (agent DELETE route)
Phase 0.3
  └→ Phase 1.1 (agent PATCH meta route)
Phase 0.2
  └→ Phase 2.1 (agentFetch)
       └→ Phase 2.2 (MechaLocator)
       └→ Phase 2.3 (remote session functions)
            └→ Phase 3.1–3.6 (CLI --node)
            └→ Phase 4.1–4.3 (dashboard)
Phase 1.3 (agent GET session)
  └→ Phase 2.3
```

## File Inventory

| Phase | New Files | Modified Files |
|---|---|---|
| 0.1 | `core/__tests__/mecha-ref.test.ts` | `core/src/types.ts`, `core/src/index.ts` |
| 0.2 | — | `contracts/src/errors.ts`, `contracts/src/index.ts` |
| 0.3 | — | `contracts/src/schemas.ts`, `contracts/src/index.ts` |
| 0.4 | — | `core/src/session-meta.ts`, `core/src/index.ts` |
| 0.5 | — | `service/src/sessions.ts`, `service/__tests__/service-new.test.ts` |
| 1.1 | — | `agent/src/routes/sessions.ts`, `agent/__tests__/routes/sessions.test.ts` |
| 1.2 | — | (same as 1.1) |
| 1.3 | — | (same as 1.1) |
| 2.1 | `service/src/agent-client.ts`, `service/__tests__/agent-client.test.ts` | `service/src/index.ts` |
| 2.2 | `service/src/locator.ts`, `service/__tests__/locator.test.ts` | `service/src/index.ts` |
| 2.3 | `service/src/remote-sessions.ts`, `service/__tests__/remote-sessions.test.ts` | `service/src/index.ts` |
| 3.1 | `cli/src/commands/shared-options.ts`, `cli/src/commands/resolve-target.ts`, `cli/__tests__/commands/resolve-target.test.ts` | — |
| 3.2–3.6 | — | `cli/src/commands/sessions.ts`, `cli/__tests__/commands/sessions.test.ts` |
| 4.1 | — | `dashboard/src/lib/store.ts` |
| 4.2 | — | `dashboard/src/app/api/mechas/[id]/sessions/*` |
| 4.3 | — | `dashboard/src/app/api/mechas/[id]/sessions/[sessionId]/message/route.ts` |
