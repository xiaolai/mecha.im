import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botFind, buildHierarchy, flattenHierarchy } from "@mecha/service";
import { readNodes } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

/* v8 ignore start -- remote node fetch requires live mesh network */
/** Fetch bots from a remote node via agent API. */
async function fetchRemoteBots(
  host: string,
  port: number,
  apiKey?: string,
  sourceName = "local",
): Promise<Array<{ name: string; state: string; port: number; tags: string[] }>> {
  const headers: Record<string, string> = { "X-Mecha-Source": sourceName };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  try {
    const resp = await fetch(`http://${host}:${port}/bots`, { headers, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return [];
    return (await resp.json()) as Array<{ name: string; state: string; port: number; tags: string[] }>;
  } catch { return []; }
}
/* v8 ignore stop */

/** Register the 'bot ls' subcommand. */
export function registerBotLsCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("ls")
    .description("List bot processes")
    .option("--mesh", "Include bots from all registered nodes")
    .action(async (opts: { mesh?: boolean }) => withErrorHandler(deps, async () => {
      const list = botFind(deps.mechaDir, deps.processManager, {});

      // Fetch remote bots if --mesh
      const remoteBots: Array<{ node: string; name: string; state: string; port: number; tags: string[] }> = [];
      /* v8 ignore start -- mesh branch requires live remote nodes */
      if (opts.mesh) {
        const nodes = readNodes(deps.mechaDir);
        const fetches = nodes
          .filter((n) => !n.managed)
          .map(async (n) => {
            const bots = await fetchRemoteBots(n.host, n.port, n.apiKey);
            return bots.map((b) => ({ ...b, node: n.name }));
          });
        const results = await Promise.all(fetches);
        for (const r of results) remoteBots.push(...r);
      }
      /* v8 ignore stop */

      if (list.length === 0 && remoteBots.length === 0) {
        deps.formatter.info("No bots found");
        return;
      }

      const tree = buildHierarchy(list);
      const flat = flattenHierarchy(tree);

      const localRows = flat.map(({ bot, depth }) => [
        "  ".repeat(depth) + bot.name,
        bot.state,
        String(bot.port ?? "-"),
        String(bot.pid ?? "-"),
        bot.tags.join(", ") || "-",
        "local",
      ]);

      const remoteRows = remoteBots.map((b) => [
        b.name,
        b.state,
        String(b.port ?? "-"),
        "-",
        (b.tags ?? []).join(", ") || "-",
        b.node,
      ]);

      deps.formatter.table(
        ["Name", "State", "Port", "PID", "Tags", "Node"],
        [...localRows, ...remoteRows],
      );
    }));
}
