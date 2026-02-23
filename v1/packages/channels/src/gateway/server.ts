import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createProcessManager } from "@mecha/process";
import type { ProcessManager } from "@mecha/process";
import { ChannelStore } from "../db/store.js";
import { TelegramAdapter } from "../adapters/telegram.js";
import type { ChannelAdapter } from "../adapters/types.js";
import { handleInbound } from "./router.js";
import type { GatewayDeps } from "./router.js";

export interface GatewayServerOptions {
  dbPath: string;
  port?: number;
  host?: string;
}

export interface GatewayServer {
  app: FastifyInstance;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function createGatewayServer(opts: GatewayServerOptions): Promise<GatewayServer> {
  const { dbPath, port = 7650, host = "127.0.0.1" } = opts;
  const store = new ChannelStore(dbPath);
  const pm: ProcessManager = createProcessManager();
  const adapters = new Map<string, ChannelAdapter>();
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => ({ status: "ok" }));

  const deps: GatewayDeps = { store, adapters, pm };

  async function start(): Promise<void> {
    // Start Fastify first so health checks work even if adapters fail
    await app.listen({ port, host });

    // Load all enabled channels and create adapters
    const channels = store.listChannels();
    for (const ch of channels) {
      if (!ch.enabled) continue;
      /* v8 ignore start */
      if (ch.type !== "telegram") continue;
      /* v8 ignore stop */
      try {
        const config = JSON.parse(ch.config) as { botToken?: string };
        if (!config.botToken) continue;
        const adapter = new TelegramAdapter(ch.id, config.botToken);
        adapters.set(ch.id, adapter);
        /* v8 ignore start */
        await adapter.start((channelId, msg) => handleInbound(deps, channelId, msg));
        /* v8 ignore stop */
      } catch {
        // Skip channels with invalid config — don't abort the entire gateway
      }
    }
  }

  async function stop(): Promise<void> {
    await Promise.allSettled([...adapters.values()].map((a) => a.stop()));
    adapters.clear();
    try { await app.close(); } finally { store.close(); }
  }

  return { app, start, stop };
}
