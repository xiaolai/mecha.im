import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { createAuditLog } from "@mecha/mcp-server";

export function registerAuditClearCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("clear")
    .description("Clear the MCP audit log")
    .action(() =>
      withErrorHandler(deps, async () => {
        const audit = createAuditLog(deps.mechaDir);
        audit.clear();
        deps.formatter.success("Audit log cleared.");
      }),
    );
}
