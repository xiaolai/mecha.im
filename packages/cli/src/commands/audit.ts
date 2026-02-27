import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerAuditLogCommand } from "./audit-log.js";
import { registerAuditClearCommand } from "./audit-clear.js";

export function registerAuditCommand(program: Command, deps: CommandDeps): void {
  const audit = program
    .command("audit")
    .description("MCP audit log management");

  registerAuditLogCommand(audit, deps);
  registerAuditClearCommand(audit, deps);
}
