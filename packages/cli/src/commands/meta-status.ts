import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readNodes } from "@mecha/core";
import { nodePing } from "@mecha/service";

/** Execute the meta status logic (exported for testing). */
export async function executeMetaStatus(deps: CommandDeps): Promise<void> {
  // Show meta-agent bot status
  const metaBot = deps.processManager.get("meta-agent" as never);
  if (!metaBot || metaBot.state !== "running") {
    deps.formatter.info("Meta-agent is not running");
    return;
  }

  deps.formatter.info(`Meta-agent: running (port ${metaBot.port})`);

  // Show recent workflow runs
  const workflowsDir = join(deps.mechaDir, "workflows", "runs");
  if (!existsSync(workflowsDir)) {
    deps.formatter.info("No workflow runs yet");
  } else {
    const workflows = readdirSync(workflowsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    let totalRuns = 0;
    let activeRuns = 0;
    for (const wf of workflows) {
      const runDir = join(workflowsDir, wf);
      const runs = readdirSync(runDir).filter((f) => f.endsWith(".json"));
      for (const r of runs) {
        totalRuns++;
        try {
          const state = JSON.parse(readFileSync(join(runDir, r), "utf-8"));
          if (state.status === "running" || state.status === "waiting") activeRuns++;
        /* v8 ignore start -- corrupt run file */
        } catch { /* skip */ }
        /* v8 ignore stop */
      }
    }

    deps.formatter.info(`Workflows: ${workflows.length} defined, ${totalRuns} runs (${activeRuns} active)`);
  }

  // Show remote node status
  const nodes = readNodes(deps.mechaDir);
  if (nodes.length === 0) return;

  deps.formatter.info("");
  deps.formatter.info("Remote nodes:");

  const results = await Promise.all(
    nodes.map(async (node) => {
      const ping = await nodePing(deps.mechaDir, node.name);
      return { name: node.name, ...ping };
    }),
  );

  for (const r of results) {
    if (r.reachable) {
      deps.formatter.info(`  ${r.name}: online (${r.latencyMs}ms, ${r.method})`);
    } else {
      deps.formatter.info(`  ${r.name}: offline${r.error ? ` — ${r.error}` : ""}`);
    }
  }
}

/* v8 ignore start -- commander wiring tested via executeMetaStatus */
/** Register the 'meta status' subcommand. */
export function registerMetaStatusCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("status")
    .description("Show meta-agent status and recent activity")
    .action(async () => withErrorHandler(deps, () => executeMetaStatus(deps)));
}
/* v8 ignore stop */
