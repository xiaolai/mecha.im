import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";
import { getNode } from "@mecha/core";
import { setProcessManager } from "./lib/pm-singleton.js";
import { parseSessionCookie, verifySessionToken, deriveSessionKey } from "./lib/session.js";
import { createPtyManager } from "./lib/pty-manager.js";
import { handleTerminalConnection } from "./lib/ws-handler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface StartDashboardOpts {
  port: number;
  host: string;
  processManager: ProcessManager;
  mechaDir: string;
  acl: AclEngine;
  sessionTtlHours?: number;
}

export async function startDashboard(opts: StartDashboardOpts): Promise<() => Promise<void>> {
  const isNetworkHost = opts.host !== "127.0.0.1" && opts.host !== "localhost";
  if (isNetworkHost && !process.env.MECHA_OTP) {
    throw new Error(
      "MECHA_OTP not set. Run 'mecha dashboard totp setup' to generate a TOTP secret before exposing the dashboard to the network.",
    );
  }

  // Set env var for middleware (Edge runtime can read process.env)
  if (isNetworkHost) {
    process.env.MECHA_NETWORK_MODE = "true";
  }

  // Pre-compute session signing key so Edge middleware can verify JWTs
  // without importing node:crypto (which isn't available in Edge runtime)
  if (process.env.MECHA_OTP) {
    process.env.MECHA_SESSION_KEY = deriveSessionKey(process.env.MECHA_OTP);
  }

  setProcessManager(opts.processManager, opts.mechaDir, opts.acl, {
    networkMode: isNetworkHost,
    sessionTtlHours: opts.sessionTtlHours,
  });

  // Next.js dir is the package root (one level up from dist/)
  const dir = join(__dirname, "..");

  // Next.js default export is a callable factory but types don't declare it under NodeNext resolution
  const nextModule = await import("next");
  const nextCreate = nextModule.default as unknown as (opts: {
    dev: boolean; hostname: string; port: number; dir: string;
  }) => { getRequestHandler(): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void; prepare(): Promise<void>; close(): Promise<void> };
  const app = nextCreate({ dev: false, hostname: opts.host, port: opts.port, dir });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer(handle);

  // PTY manager for terminal WebSocket connections
  const nodePty = await import("node-pty");
  const ptyManager = createPtyManager({
    processManager: opts.processManager,
    mechaDir: opts.mechaDir,
    spawnFn: nodePty.spawn,
  });

  // WebSocket server for terminal connections
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);

    // Only handle /ws/* paths
    if (!url.pathname.startsWith("/ws/")) {
      socket.destroy();
      return;
    }

    // Validate session cookie when TOTP is configured
    const otpSecret = process.env.MECHA_OTP;
    if (otpSecret) {
      const cookie = parseSessionCookie(request.headers.cookie ?? "");
      const sessionKey = deriveSessionKey(otpSecret);
      if (!cookie || !verifySessionToken(sessionKey, cookie).valid) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      handleTerminalConnection(ws, url, {
        ptyManager,
        getNode: (name) => getNode(opts.mechaDir, name),
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  // Handle post-listen errors — log and close gracefully on fatal errors
  server.on("error", (err) => {
    console.error("[dashboard] server error:", err.message);
    // Fatal errors (EMFILE, EADDRINUSE) warrant shutdown
    const fatal = new Set(["EMFILE", "ENFILE", "EADDRINUSE", "EACCES"]);
    if ("code" in err && fatal.has(err.code as string)) {
      console.error("[dashboard] fatal server error, shutting down");
      server.close();
      app.close().catch(() => {});
    }
  });

  return async () => {
    ptyManager.shutdown();
    wss.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await app.close();
  };
}
