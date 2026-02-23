import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import type { Formatter } from "../output/formatter.js";
import { toUserMessage, toExitCode } from "@mecha/contracts";

type AgentModule = typeof import("@mecha/agent");

async function loadAgent(): Promise<AgentModule> {
  return import("@mecha/agent");
}

function handleError(formatter: Formatter, err: unknown): void {
  formatter.error(toUserMessage(err));
  process.exitCode = toExitCode(err);
}

export function registerNodeCommand(parent: Command, deps: CommandDeps): void {
  const node = parent
    .command("node")
    .description("Manage mesh peer nodes");

  node
    .command("add <name> <host>")
    .description("Register a remote node")
    .requiredOption("--key <apiKey>", "API key for the remote agent")
    .action(async (name: string, host: string, opts: { key: string }) => {
      const { formatter } = deps;
      try {
        const mod = await loadAgent();
        const entry = mod.addNode(name, host, opts.key);
        formatter.success(`Node added: ${entry.name} (${entry.host})`);
      } catch (err) {
        handleError(formatter, err);
      }
    });

  node
    .command("rm <name>")
    .description("Remove a registered node")
    .action(async (name: string) => {
      const { formatter } = deps;
      try {
        const mod = await loadAgent();
        mod.removeNode(name);
        formatter.success(`Node removed: ${name}`);
      } catch (err) {
        handleError(formatter, err);
      }
    });

  node
    .command("ls")
    .description("List all registered nodes")
    .action(async () => {
      const { formatter } = deps;
      try {
        const mod = await loadAgent();
        const nodes = mod.readNodes();
        if (nodes.length === 0) {
          formatter.info("No nodes registered");
          return;
        }
        formatter.table(
          nodes.map((n) => ({ NAME: n.name, HOST: n.host, KEY: n.key.slice(0, 8) + "..." })),
          ["NAME", "HOST", "KEY"],
        );
      } catch (err) {
        handleError(formatter, err);
      }
    });

  node
    .command("ping [name]")
    .description("Health-check one or all nodes")
    .action(async (name?: string) => {
      const { formatter } = deps;
      try {
        const mod = await loadAgent();
        const nodes = mod.readNodes();
        const targets = name ? nodes.filter((n) => n.name === name) : nodes;

        if (targets.length === 0) {
          formatter.info(name ? `Node "${name}" not found` : "No nodes registered");
          return;
        }

        for (const target of targets) {
          const normalized = target.host.includes("://") ? target.host : `http://${target.host}`;
          const parsed = new URL(normalized);
          const hostOnly = parsed.hostname;
          const port = parsed.port ? Number(parsed.port) : 7660;
          const result = await mod.probeMechaAgent(hostOnly, port);
          if (result.ok) {
            formatter.success(`${target.name} (${target.host}): OK — node=${result.node ?? "?"}`);
          } else {
            formatter.error(`${target.name} (${target.host}): UNREACHABLE`);
          }
        }
      } catch (err) {
        handleError(formatter, err);
      }
    });

  node
    .command("discover")
    .description("Auto-discover mecha agents on the tailnet")
    .option("-p, --port <port>", "Agent port to probe", "7660")
    .action(async (opts: { port: string }) => {
      const { formatter } = deps;
      try {
        const port = Number(opts.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          formatter.error(`Invalid port: ${opts.port}`);
          process.exitCode = 1;
          return;
        }
        const mod = await loadAgent();
        formatter.info("Discovering mecha agents on tailnet...");
        const found = await mod.discoverMechaNodes({ port });
        if (found.length === 0) {
          formatter.info("No mecha agents found on tailnet peers");
          return;
        }
        formatter.table(
          found.map((n) => ({ NAME: n.name, HOST: n.host })),
          ["NAME", "HOST"],
        );
        formatter.info(`Found ${found.length} agent(s). Use "mecha node add" to register them.`);
      } catch (err) {
        handleError(formatter, err);
      }
    });
}
