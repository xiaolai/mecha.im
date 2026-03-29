import type { TaskRequest, TaskResponse, BackendCommand } from "./types";

const BACKEND = process.env.WORKER_BACKEND || "claude";
const PORT = parseInt(process.env.WORKER_PORT || "8080");
const TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT || "600000"); // 10m

let busy = false;

async function loadBackend(): Promise<(prompt: string) => BackendCommand> {
  const mod = await import(`./backends/${BACKEND}.ts`);
  return mod.buildCommand;
}

const buildCommand = await loadBackend();

function healthHandler(): Response {
  return new Response("ok", { status: 200 });
}

async function taskHandler(req: Request): Promise<Response> {
  if (busy) {
    return Response.json({ error: "worker busy" }, { status: 429 });
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

  busy = true;
  const start = Date.now();

  try {
    const cmd = buildCommand(body.prompt);
    const proc = Bun.spawn([cmd.command, ...cmd.args], {
      cwd: "/workspace",
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    clearTimeout(timer);
    const exitCode = await proc.exited;
    const durationMs = Date.now() - start;

    const result: TaskResponse = {
      output: stdout.trim(),
      metadata: {
        model: process.env[`${BACKEND.toUpperCase()}_MODEL`] || undefined,
        duration_ms: durationMs,
        exit_code: exitCode,
      },
    };

    if (stderr.trim()) {
      result.output += "\n\n--- stderr ---\n" + stderr.trim();
    }

    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("ENOENT")) {
      return Response.json({ error: `${BACKEND} CLI not found` }, { status: 500 });
    }
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    busy = false;
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
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

console.log(`mecha worker (${BACKEND}) listening on :${server.port}`);
