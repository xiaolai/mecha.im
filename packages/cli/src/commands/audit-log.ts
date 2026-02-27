import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { createAuditLog } from "@mecha/mcp-server";

export function registerAuditLogCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("log")
    .description("View the MCP audit log")
    .option("--limit <n>", "Show last N entries", "50")
    .action((opts: { limit: string }) =>
      withErrorHandler(deps, async () => {
        const limit = parseInt(opts.limit, 10);
        const audit = createAuditLog(deps.mechaDir);
        /* v8 ignore start -- commander enforces default "50", NaN is defensive */
        const entries = audit.read({ limit: isNaN(limit) ? 50 : limit });
        /* v8 ignore stop */

        if (entries.length === 0) {
          deps.formatter.info("No audit entries found.");
          return;
        }

        if (deps.formatter.isJson) {
          deps.formatter.json(entries);
          return;
        }

        for (const entry of entries) {
          const status = entry.result === "ok" ? "ok" : `error: ${entry.error}`;
          deps.formatter.info(
            `[${entry.ts}] ${entry.tool} (${entry.client}) — ${status} (${entry.durationMs}ms)`,
          );
        }
      }),
    );
}
