import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";
import { setProcessManager } from "./lib/pm-singleton.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface StartDashboardOpts {
  port: number;
  host: string;
  processManager: ProcessManager;
  mechaDir: string;
  acl: AclEngine;
}

export async function startDashboard(opts: StartDashboardOpts): Promise<() => Promise<void>> {
  setProcessManager(opts.processManager, opts.mechaDir, opts.acl);

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

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  // Handle post-listen errors (e.g. EMFILE) to prevent unhandled crash
  server.on("error", (err) => {
    console.error("[dashboard] server error:", err.message);
  });

  return async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await app.close();
  };
}
