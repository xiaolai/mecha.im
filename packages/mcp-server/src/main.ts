import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createProcessManager } from "@mecha/process";
import { agentFetch } from "@mecha/service";
import { readNodes, MECHA_DIR } from "@mecha/core";
import { createMeshMcpServer } from "./server.js";
import { createAuditLog } from "./audit.js";
import { createRateLimiter } from "./rate-limit.js";
import { runStdio } from "./transport.js";
import { runHttp } from "./http-transport.js";

const VALID_MODES = ["read-only", "query"] as const;
const VALID_TRANSPORTS = ["stdio", "http"] as const;

export async function main(opts: {
  mode?: string;
  transport?: "stdio" | "http";
  port?: number;
  host?: string;
  token?: string;
}): Promise<void> {
  // #9: Strict mode validation — fail-closed instead of defaulting to "query"
  const mode = opts.mode ?? "query";
  if (!VALID_MODES.includes(mode as (typeof VALID_MODES)[number])) {
    throw new Error(`Invalid mode "${opts.mode}". Must be one of: ${VALID_MODES.join(", ")}`);
  }

  const transport = opts.transport ?? "stdio";
  if (!VALID_TRANSPORTS.includes(transport as (typeof VALID_TRANSPORTS)[number])) {
    throw new Error(`Invalid transport "${opts.transport}". Must be one of: ${VALID_TRANSPORTS.join(", ")}`);
  }

  // #10: Validate port range
  if (opts.port !== undefined) {
    if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
      throw new Error(`Invalid port "${opts.port}". Must be an integer between 1 and 65535`);
    }
  }

  const mechaDir = process.env.MECHA_DIR ?? join(homedir(), MECHA_DIR);

  // Validate mechaDir exists before starting
  if (!existsSync(mechaDir)) {
    throw new Error(`MECHA_DIR "${mechaDir}" does not exist. Run \`mecha init\` first.`);
  }

  const pm = createProcessManager({ mechaDir });
  const getNodes = () => readNodes(mechaDir);
  const audit = createAuditLog(mechaDir);
  const rateLimiter = createRateLimiter();

  const validatedMode = mode as "read-only" | "query";

  const createServer = () =>
    createMeshMcpServer({
      mechaDir,
      pm,
      getNodes,
      agentFetch,
      mode: validatedMode,
      audit,
      rateLimiter,
    });

  if (transport === "http") {
    await runHttp(createServer, {
      port: opts.port ?? 7680,
      host: opts.host ?? "127.0.0.1",
      token: opts.token,
    });
  } else {
    await runStdio(createServer());
  }
}
