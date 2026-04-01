import { describe, test, expect } from "bun:test";
import type { TaskRequest, TaskResponse, BackendExecutor } from "./types";

// ---------------------------------------------------------------------------
// Helpers: replicate the exact server.ts handler logic so we can test it
// without importing (server.ts has a side-effect: it binds a port on import).
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB — matches server.ts

interface ServerOpts {
  port: number;
  apiKey?: string;
  dryRun?: boolean;
  executor?: BackendExecutor;
}

/** Spin up a Bun server with the same routing and validation as server.ts. */
function createTestServer(opts: ServerOpts) {
  let busy = false;
  const apiKey = opts.apiKey ?? "";
  const dryRun = opts.dryRun ?? false;
  const executor: BackendExecutor =
    opts.executor ??
    (async (prompt) => ({ output: `echo: ${prompt}`, metadata: { exit_code: 0 } }));

  function checkApiKey(req: Request): Response | null {
    if (!apiKey) return null;
    const url = new URL(req.url);
    if (url.pathname === "/health") return null;

    const authHeader = req.headers.get("authorization") || "";
    const apiKeyHeader = req.headers.get("x-api-key") || "";

    if (authHeader === `Bearer ${apiKey}` || apiKeyHeader === apiKey) {
      return null;
    }
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  function healthHandler(): Response {
    if (busy) {
      return new Response("busy", { status: 503 });
    }
    return new Response("ok", { status: 200 });
  }

  async function taskHandler(req: Request): Promise<Response> {
    if (busy) {
      return Response.json({ error: "worker busy" }, { status: 429 });
    }

    busy = true;
    try {
      const clHeader = req.headers.get("content-length");
      if (!clHeader) {
        return Response.json({ error: "Content-Length required" }, { status: 411 });
      }
      const contentLength = parseInt(clHeader);
      if (contentLength > MAX_BODY_BYTES) {
        return Response.json({ error: "request body too large" }, { status: 413 });
      }

      let body: TaskRequest;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
      }

      if (!body.prompt) {
        return Response.json({ error: "missing prompt" }, { status: 400 });
      }

      if (dryRun) {
        return Response.json({ dry_run: true, backend: "claude", prompt: body.prompt });
      }

      const result = await executor(body.prompt);
      return Response.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`task handler error: ${msg}`);
      return Response.json({ error: "internal server error" }, { status: 500 });
    } finally {
      busy = false;
    }
  }

  const server = Bun.serve({
    port: opts.port,
    async fetch(req) {
      const denied = checkApiKey(req);
      if (denied) return denied;

      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return healthHandler();
      }
      if (url.pathname === "/task" && req.method === "POST") {
        return taskHandler(req);
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  return {
    server,
    url: `http://localhost:${server.port}`,
    /** Force the busy flag on — used for testing 429/503 paths. */
    setBusy(v: boolean) {
      busy = v;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: POST JSON with explicit Content-Length so Bun doesn't strip it.
// ---------------------------------------------------------------------------
function postJson(url: string, body: unknown, headers?: Record<string, string>) {
  const raw = JSON.stringify(body);
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw,
  });
}

// ============================= Tests ======================================

// -- API key validation ----------------------------------------------------

describe("API key validation", () => {
  test("allows all requests when no API key configured", async () => {
    const s = createTestServer({ port: 18090 });
    try {
      const resp = await postJson(`${s.url}/task`, { id: "1", prompt: "hi" });
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.output).toBe("echo: hi");
    } finally {
      s.server.stop();
    }
  });

  test("rejects requests without valid API key", async () => {
    const s = createTestServer({ port: 18091, apiKey: "secret-key" });
    try {
      const resp = await postJson(`${s.url}/task`, { id: "1", prompt: "hi" });
      expect(resp.status).toBe(401);
      const data = await resp.json();
      expect(data.error).toBe("unauthorized");
    } finally {
      s.server.stop();
    }
  });

  test("accepts Bearer token", async () => {
    const s = createTestServer({ port: 18092, apiKey: "secret-key" });
    try {
      const resp = await postJson(
        `${s.url}/task`,
        { id: "1", prompt: "hi" },
        { Authorization: "Bearer secret-key" },
      );
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.output).toBe("echo: hi");
    } finally {
      s.server.stop();
    }
  });

  test("accepts X-API-Key header", async () => {
    const s = createTestServer({ port: 18093, apiKey: "secret-key" });
    try {
      const resp = await postJson(
        `${s.url}/task`,
        { id: "1", prompt: "hi" },
        { "X-API-Key": "secret-key" },
      );
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.output).toBe("echo: hi");
    } finally {
      s.server.stop();
    }
  });

  test("rejects wrong Bearer token", async () => {
    const s = createTestServer({ port: 18094, apiKey: "secret-key" });
    try {
      const resp = await postJson(
        `${s.url}/task`,
        { id: "1", prompt: "hi" },
        { Authorization: "Bearer wrong-key" },
      );
      expect(resp.status).toBe(401);
    } finally {
      s.server.stop();
    }
  });

  test("health endpoint bypasses API key", async () => {
    const s = createTestServer({ port: 18095, apiKey: "secret-key" });
    try {
      // No auth headers at all — /health should still be 200
      const resp = await fetch(`${s.url}/health`);
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("ok");
    } finally {
      s.server.stop();
    }
  });
});

// -- Health endpoint -------------------------------------------------------

describe("health endpoint", () => {
  test("returns 200 when not busy", async () => {
    const s = createTestServer({ port: 18096 });
    try {
      const resp = await fetch(`${s.url}/health`);
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("ok");
    } finally {
      s.server.stop();
    }
  });

  test("returns 503 when busy", async () => {
    const s = createTestServer({ port: 18097 });
    try {
      s.setBusy(true);
      const resp = await fetch(`${s.url}/health`);
      expect(resp.status).toBe(503);
      expect(await resp.text()).toBe("busy");
    } finally {
      s.server.stop();
    }
  });
});

// -- Task endpoint ---------------------------------------------------------

describe("task endpoint", () => {
  test("rejects missing Content-Length", async () => {
    const s = createTestServer({ port: 18098 });
    try {
      // Use a ReadableStream body so Bun cannot pre-compute Content-Length
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ id: "1", prompt: "hi" })));
          controller.close();
        },
      });
      const resp = await fetch(`${s.url}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stream,
        // @ts-ignore — Bun supports duplex for streaming bodies
        duplex: "half",
      });
      expect(resp.status).toBe(411);
      const data = await resp.json();
      expect(data.error).toBe("Content-Length required");
    } finally {
      s.server.stop();
    }
  });

  test("rejects body larger than 10MB", async () => {
    const s = createTestServer({ port: 18099 });
    try {
      // Bun's fetch overrides Content-Length with actual body size, so we use
      // node:net to send a raw HTTP request with a spoofed Content-Length.
      const net = await import("node:net");
      const response = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const client = net.createConnection({ port: 18099, host: "localhost" }, () => {
          const raw =
            `POST /task HTTP/1.1\r\n` +
            `Host: localhost:18099\r\n` +
            `Content-Type: application/json\r\n` +
            `Content-Length: ${MAX_BODY_BYTES + 1}\r\n` +
            `Connection: close\r\n` +
            `\r\n` +
            `{"id":"1","prompt":"hi"}`;
          client.write(raw);
        });
        client.on("data", (chunk) => chunks.push(chunk));
        client.on("end", () => resolve(Buffer.concat(chunks).toString()));
        client.on("error", reject);
      });
      expect(response).toContain("413");
      expect(response).toContain("request body too large");
    } finally {
      s.server.stop();
    }
  });

  test("rejects missing prompt", async () => {
    const s = createTestServer({ port: 18100 });
    try {
      const resp = await postJson(`${s.url}/task`, { id: "test-no-prompt" });
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toBe("missing prompt");
    } finally {
      s.server.stop();
    }
  });

  test("rejects empty string prompt", async () => {
    const s = createTestServer({ port: 18101 });
    try {
      const resp = await postJson(`${s.url}/task`, { id: "1", prompt: "" });
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toBe("missing prompt");
    } finally {
      s.server.stop();
    }
  });

  test("rejects invalid JSON", async () => {
    const s = createTestServer({ port: 18102 });
    try {
      const resp = await fetch(`${s.url}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": "12" },
        body: "not-valid-js",
      });
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toBe("invalid JSON");
    } finally {
      s.server.stop();
    }
  });

  test("returns 429 when busy", async () => {
    const s = createTestServer({ port: 18103 });
    try {
      s.setBusy(true);
      const resp = await postJson(`${s.url}/task`, { id: "1", prompt: "hi" });
      expect(resp.status).toBe(429);
      const data = await resp.json();
      expect(data.error).toBe("worker busy");
    } finally {
      s.server.stop();
    }
  });

  test("routes to executor on valid request", async () => {
    let receivedPrompt = "";
    const executor: BackendExecutor = async (prompt) => {
      receivedPrompt = prompt;
      return {
        output: "review complete",
        metadata: { model: "claude-sonnet-4-6", exit_code: 0, duration_ms: 1234 },
      };
    };
    const s = createTestServer({ port: 18104, executor });
    try {
      const resp = await postJson(`${s.url}/task`, {
        id: "task-42",
        prompt: "Review this PR",
        context: { repo: "owner/repo", ref: "main" },
      });
      expect(resp.status).toBe(200);

      const data: TaskResponse = await resp.json();
      expect(data.output).toBe("review complete");
      expect(data.metadata?.model).toBe("claude-sonnet-4-6");
      expect(data.metadata?.exit_code).toBe(0);
      expect(data.metadata?.duration_ms).toBe(1234);

      // Verify the executor received the correct prompt
      expect(receivedPrompt).toBe("Review this PR");
    } finally {
      s.server.stop();
    }
  });

  test("returns dry_run response in dry_run mode", async () => {
    const s = createTestServer({ port: 18105, dryRun: true });
    try {
      const resp = await postJson(`${s.url}/task`, { id: "1", prompt: "do something" });
      expect(resp.status).toBe(200);

      const data = await resp.json();
      expect(data.dry_run).toBe(true);
      expect(data.backend).toBe("claude");
      expect(data.prompt).toBe("do something");
    } finally {
      s.server.stop();
    }
  });

  test("dry_run does not call executor", async () => {
    let executorCalled = false;
    const executor: BackendExecutor = async () => {
      executorCalled = true;
      return { output: "should not happen" };
    };
    const s = createTestServer({ port: 18106, dryRun: true, executor });
    try {
      await postJson(`${s.url}/task`, { id: "1", prompt: "dry test" });
      expect(executorCalled).toBe(false);
    } finally {
      s.server.stop();
    }
  });

  test("returns 500 when executor throws", async () => {
    const executor: BackendExecutor = async () => {
      throw new Error("backend crash");
    };
    const s = createTestServer({ port: 18107, executor });
    try {
      const resp = await postJson(`${s.url}/task`, { id: "1", prompt: "crash" });
      expect(resp.status).toBe(500);
      const data = await resp.json();
      expect(data.error).toBe("internal server error");
    } finally {
      s.server.stop();
    }
  });

  test("resets busy flag after executor throws", async () => {
    const executor: BackendExecutor = async () => {
      throw new Error("temporary failure");
    };
    const s = createTestServer({ port: 18108, executor });
    try {
      // First request — executor throws, but busy should reset
      const resp1 = await postJson(`${s.url}/task`, { id: "1", prompt: "fail" });
      expect(resp1.status).toBe(500);

      // Second request should NOT be 429 (busy cleared by finally block)
      const resp2 = await postJson(`${s.url}/task`, { id: "2", prompt: "retry" });
      expect(resp2.status).toBe(500); // still throws, but not 429
    } finally {
      s.server.stop();
    }
  });
});

// -- Routing ---------------------------------------------------------------

describe("routing", () => {
  test("returns 404 for unknown paths", async () => {
    const s = createTestServer({ port: 18109 });
    try {
      const resp = await fetch(`${s.url}/unknown`);
      expect(resp.status).toBe(404);
      const data = await resp.json();
      expect(data.error).toBe("not found");
    } finally {
      s.server.stop();
    }
  });

  test("returns 404 for GET /task", async () => {
    const s = createTestServer({ port: 18110 });
    try {
      const resp = await fetch(`${s.url}/task`);
      expect(resp.status).toBe(404);
      const data = await resp.json();
      expect(data.error).toBe("not found");
    } finally {
      s.server.stop();
    }
  });

  test("returns 404 for POST /health", async () => {
    const s = createTestServer({ port: 18111 });
    try {
      const resp = await fetch(`${s.url}/health`, { method: "POST" });
      expect(resp.status).toBe(404);
      const data = await resp.json();
      expect(data.error).toBe("not found");
    } finally {
      s.server.stop();
    }
  });

  test("returns 404 for PUT /task", async () => {
    const s = createTestServer({ port: 18112 });
    try {
      const resp = await fetch(`${s.url}/task`, { method: "PUT" });
      expect(resp.status).toBe(404);
    } finally {
      s.server.stop();
    }
  });

  test("returns 404 for root path", async () => {
    const s = createTestServer({ port: 18113 });
    try {
      const resp = await fetch(`${s.url}/`);
      expect(resp.status).toBe(404);
    } finally {
      s.server.stop();
    }
  });
});

// -- Types -----------------------------------------------------------------

describe("types", () => {
  test("TaskRequest has required fields", () => {
    const req: TaskRequest = { id: "abc", prompt: "hello" };
    expect(req.id).toBe("abc");
    expect(req.prompt).toBe("hello");
    expect(req.context).toBeUndefined();
  });

  test("TaskRequest accepts optional context", () => {
    const req: TaskRequest = {
      id: "abc",
      prompt: "hello",
      context: { repo: "owner/repo", ref: "main", files: ["a.ts"], diff: "diff text" },
    };
    expect(req.context?.repo).toBe("owner/repo");
    expect(req.context?.ref).toBe("main");
    expect(req.context?.files).toEqual(["a.ts"]);
    expect(req.context?.diff).toBe("diff text");
  });

  test("TaskResponse has output field", () => {
    const resp: TaskResponse = { output: "done", metadata: { exit_code: 0 } };
    expect(resp.output).toBe("done");
    expect(resp.metadata?.exit_code).toBe(0);
  });

  test("TaskResponse supports all optional fields", () => {
    const resp: TaskResponse = {
      output: "reviewed",
      comment: { target: "pr:42", body: "Looks good" },
      labels: { add: ["approved"], remove: ["needs-review"] },
      status: { state: "success", description: "All checks passed" },
      commit: { message: "fix: typo", diff: "--- a\n+++ b" },
      metadata: {
        model: "claude-sonnet-4-6",
        input_tokens: 5000,
        output_tokens: 2000,
        duration_ms: 45000,
        exit_code: 0,
      },
    };
    expect(resp.comment?.target).toBe("pr:42");
    expect(resp.labels?.add).toEqual(["approved"]);
    expect(resp.labels?.remove).toEqual(["needs-review"]);
    expect(resp.status?.state).toBe("success");
    expect(resp.commit?.message).toBe("fix: typo");
    expect(resp.metadata?.model).toBe("claude-sonnet-4-6");
    expect(resp.metadata?.input_tokens).toBe(5000);
    expect(resp.metadata?.output_tokens).toBe(2000);
  });
});
