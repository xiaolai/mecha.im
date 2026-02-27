import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort, writeServerState, removeServerState, loadNodeIdentity, loadNodePrivateKey, createNoiseKeys, readServerState, signMessage } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

interface AgentStartOpts {
  port: string;
  apiKey?: string;
  host: string;
  server: boolean;
  serverPort: string;
  publicAddr?: string;
  rendezvous?: string;
}

export function registerAgentStartCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("start")
    .description("Start the agent server for cross-node communication")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .option("--api-key <key>", "API key for authentication (or set MECHA_AGENT_API_KEY)")
    .option("--host <host>", "Bind address (default: 127.0.0.1)", "127.0.0.1")
    .option("--server", "Enable embedded rendezvous + relay server", false)
    .option("--server-port <port>", "Embedded server listen port", String(DEFAULTS.EMBEDDED_SERVER_PORT))
    .option("--public-addr <url>", "Externally reachable address (e.g., wss://myhost:7681)")
    .option("--rendezvous <url>", "Rendezvous server URL for signaling registration")
    .action(async (opts: AgentStartOpts) => withErrorHandler(deps, async () => {
      const port = parsePort(opts.port);
      if (port === undefined) {
        deps.formatter.error(`Invalid port: ${opts.port}`);
        process.exitCode = 1;
        return;
      }
      const apiKey = (opts.apiKey ?? process.env.MECHA_AGENT_API_KEY ?? "").trim();
      if (!apiKey) {
        deps.formatter.error("API key required: use --api-key or set MECHA_AGENT_API_KEY");
        process.exitCode = 1;
        return;
      }

      // Lazy import to avoid pulling in fastify when not needed
      const { createAgentServer } = await import("@mecha/agent");
      const { readNodeName } = await import("@mecha/service");

      const nodeName = readNodeName(deps.mechaDir) ?? "unknown";
      const server = createAgentServer({
        port,
        apiKey,
        processManager: deps.processManager,
        acl: deps.acl,
        mechaDir: deps.mechaDir,
        nodeName,
      });

      /* v8 ignore start -- shutdown hook only fires on process signal */
      deps.registerShutdownHook?.(() => server.close());
      /* v8 ignore stop */

      // Start embedded rendezvous server if requested
      if (opts.server) {
        const serverPort = parsePort(opts.serverPort);
        if (serverPort === undefined) {
          deps.formatter.error(`Invalid server port: ${opts.serverPort}`);
          process.exitCode = 1;
          return;
        }

        const { createServer: createRendezvousServer } = await import("@mecha/server");
        const rvServer = await createRendezvousServer({ port: serverPort, host: opts.host });
        await rvServer.listen({ port: serverPort, host: opts.host });

        writeServerState(deps.mechaDir, {
          port: serverPort,
          host: opts.host,
          publicAddr: opts.publicAddr,
          startedAt: new Date().toISOString(),
        });

        /* v8 ignore start -- shutdown hook only fires on process signal */
        deps.registerShutdownHook?.(async () => {
          await rvServer.close();
          removeServerState(deps.mechaDir);
        });
        /* v8 ignore stop */

        deps.formatter.info(`Embedded server started on ${opts.host}:${serverPort}`);
        if (!opts.publicAddr) {
          deps.formatter.warn("No --public-addr set — server is local-only");
        }
      }

      const host = opts.host;
      await server.listen({ port, host });
      deps.formatter.success(`Agent server started on ${host}:${port} (node: ${nodeName})`);

      // Auto-register on signaling WebSocket for P2P presence
      /* v8 ignore start -- signaling registration requires live server */
      const identity = loadNodeIdentity(deps.mechaDir);
      const privateKey = loadNodePrivateKey(deps.mechaDir);
      if (identity && privateKey) {
        const noiseKeys = createNoiseKeys(deps.mechaDir);
        const serverState = readServerState(deps.mechaDir);
        const rvUrl = opts.rendezvous ?? serverState?.publicAddr ?? DEFAULTS.RENDEZVOUS_URL;

        try {
          const { createRendezvousClient } = await import("@mecha/connect");
          const signFn = (data: Uint8Array): string => signMessage(privateKey, data);
          const rv = createRendezvousClient({ url: rvUrl, signFn });
          await rv.connect();
          const regIdentity = {
            name: nodeName,
            publicKey: identity.publicKey,
            noisePublicKey: noiseKeys.publicKey,
            fingerprint: identity.fingerprint,
          };
          await rv.register(regIdentity);
          deps.formatter.info(`Registered on signaling: ${rvUrl}`);

          // Keep WS alive with periodic lookup (prevents GC/idle disconnect)
          const keepAlive = setInterval(async () => {
            try { await rv.lookup(nodeName as never); } catch { /* reconnect handles this */ }
          }, 30_000);
          deps.registerShutdownHook?.(async () => { clearInterval(keepAlive); rv.close(); });
        } catch (err) {
          deps.formatter.warn(`Signaling registration failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      /* v8 ignore stop */
    }));
}
