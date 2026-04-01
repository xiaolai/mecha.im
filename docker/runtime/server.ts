import type { TaskRequest, TaskResponse, BackendExecutor } from "./types";

const PORT = parseInt(process.env.WORKER_PORT || "8081") || 8081;
const TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT || "600000") || 600000;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const DRY_RUN = process.env.WORKER_DRY_RUN === "true";
const API_KEY = process.env.WORKER_API_KEY || "";

let busy = false;
let executor: BackendExecutor;

try {
  const mod = await import("./backends/claude.ts");
  if (!mod.executeTask) {
    console.error("fatal: claude backend does not export executeTask");
    process.exit(1);
  }
  executor = mod.executeTask;
} catch (err) {
  console.error(`fatal: failed to load claude backend: ${err}`);
  process.exit(1);
}

function checkApiKey(req: Request): Response | null {
  if (!API_KEY) return null;
  const url = new URL(req.url);
  if (url.pathname === "/health") return null;

  const authHeader = req.headers.get("authorization") || "";
  const apiKeyHeader = req.headers.get("x-api-key") || "";

  if (authHeader === `Bearer ${API_KEY}` || apiKeyHeader === API_KEY) {
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

    if (DRY_RUN) {
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
  port: PORT,
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

console.log(`mecha worker listening on :${server.port}${API_KEY ? " [api-key enabled]" : ""}`);
