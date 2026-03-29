import type { TaskRequest, TaskResponse, BackendCommand, BackendExecutor } from "./types";

const BACKEND = process.env.WORKER_BACKEND || "claude";
const PORT = parseInt(process.env.WORKER_PORT || "8080");
const TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT || "600000"); // 10m
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const DRY_RUN = process.env.WORKER_DRY_RUN === "true";

let busy = false;

// SDK-based backends export executeTask(). CLI-based export buildCommand().
let sdkExecutor: BackendExecutor | null = null;
let cliBuilder: ((prompt: string) => BackendCommand) | null = null;

async function loadBackend() {
  const mod = await import(`./backends/${BACKEND}.ts`);
  if (mod.executeTask) {
    sdkExecutor = mod.executeTask;
  } else if (mod.buildCommand) {
    cliBuilder = mod.buildCommand;
  }
}

await loadBackend();

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
    const contentLength = parseInt(req.headers.get("content-length") || "0");
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

    // SDK-based backend (Claude)
    if (sdkExecutor) {
      if (DRY_RUN) {
        return Response.json({ dry_run: true, backend: BACKEND, prompt: body.prompt });
      }
      const result = await sdkExecutor(body.prompt);
      return Response.json(result);
    }

    // CLI-based backend (Codex, Gemini)
    if (cliBuilder) {
      const cmd = cliBuilder(body.prompt);

      if (DRY_RUN) {
        return Response.json({ dry_run: true, command: cmd.command, args: cmd.args });
      }

      return await execCLI(cmd);
    }

    return Response.json({ error: "no backend configured" }, { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    busy = false;
  }
}

async function execCLI(cmd: BackendCommand): Promise<Response> {
  const start = Date.now();
  const proc = Bun.spawn([cmd.command, ...cmd.args], {
    cwd: "/workspace",
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const killTimer = setTimeout(() => {
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), 5000);
  }, TIMEOUT_MS);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  clearTimeout(killTimer);
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
