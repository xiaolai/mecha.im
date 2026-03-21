import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { collectNodeInfo, fetchPublicIp, formatUptime } from "@mecha/core";

/** Execute the node info display logic. */
export async function executeNodeInfo(deps: CommandDeps): Promise<void> {
  const publicIp = await fetchPublicIp();
  const info = collectNodeInfo({
    port: 0,
    startedAt: new Date().toISOString(),
    botCount: deps.processManager.list().filter((p) => p.state === "running").length,
    publicIp,
  });

  if (deps.formatter.isJson) {
    deps.formatter.json(info);
    return;
  }

  const uptime = formatUptime(info.uptimeSeconds);
  const lines = [
    `Hostname:   ${info.hostname}`,
    `OS:         ${info.platform} ${info.arch}`,
    `Uptime:     ${uptime}`,
    "",
    "Network:",
    `  LAN:        ${info.lanIp ?? "—"}`,
    `  Tailscale:  ${info.tailscaleIp ?? "—"}`,
    `  Public:     ${info.publicIp ?? "—"}`,
    "",
    "Resources:",
    `  CPUs:       ${info.cpuCount}`,
    `  Memory:     ${info.totalMemMB} MB total / ${info.freeMemMB} MB free`,
    `  bots:      ${info.botCount} running`,
  ];
  for (const line of lines) {
    deps.formatter.info(line);
  }
}

/* v8 ignore start -- commander wiring tested via executeNodeInfo */
/** Register the 'node info' subcommand. */
export function registerNodeInfoCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("info")
    .description("Show local node system information")
    .action(async () => withErrorHandler(deps, () => executeNodeInfo(deps)));
}
/* v8 ignore stop */
