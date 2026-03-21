import type { ProcessManager, SpawnOpts, ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tool definitions for meta-agent operations (spawn/kill bots). */
export const META_TOOLS: McpToolDef[] = [
  {
    name: "meta_spawn_bot",
    description: "Spawn a new bot process",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Bot name (lowercase alphanumeric + hyphens)" },
        workspace: { type: "string", description: "Workspace path for the bot" },
        model: { type: "string", description: "Model to use (optional)" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for discovery (optional)",
        },
        systemPrompt: { type: "string", description: "System prompt override (optional)" },
      },
      required: ["name", "workspace"],
    },
  },
  {
    name: "meta_kill_bot",
    description: "Stop and remove a bot process",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the bot to kill" },
      },
      required: ["name"],
    },
  },
];

/** Runtime context for meta tool execution. */
export interface MetaToolOpts {
  processManager: ProcessManager;
}

interface MetaResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Dispatch a meta tool call and return the MCP result. */
export async function handleMetaTool(
  opts: MetaToolOpts,
  name: string,
  args: Record<string, unknown>,
): Promise<MetaResult> {
  const { processManager } = opts;

  switch (name) {
    case "meta_spawn_bot": {
      const botName = args.name;
      const workspace = args.workspace;
      if (typeof botName !== "string" || !botName) {
        return { content: [{ type: "text", text: "Missing required: name (string)" }], isError: true };
      }
      if (typeof workspace !== "string" || !workspace) {
        return { content: [{ type: "text", text: "Missing required: workspace (string)" }], isError: true };
      }

      const spawnOpts: SpawnOpts = {
        name: botName as BotName,
        workspacePath: workspace,
      };

      if (typeof args.model === "string" && args.model) {
        spawnOpts.model = args.model;
      }
      if (Array.isArray(args.tags)) {
        spawnOpts.tags = args.tags.filter((t): t is string => typeof t === "string");
      }
      if (typeof args.systemPrompt === "string" && args.systemPrompt) {
        spawnOpts.systemPrompt = args.systemPrompt;
      }

      try {
        const info: ProcessInfo = await processManager.spawn(spawnOpts);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              name: info.name,
              state: info.state,
              pid: info.pid,
              port: info.port,
            }),
          }],
        };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Failed to spawn bot: ${detail}` }], isError: true };
      }
    }

    case "meta_kill_bot": {
      const botName = args.name;
      if (typeof botName !== "string" || !botName) {
        return { content: [{ type: "text", text: "Missing required: name (string)" }], isError: true };
      }

      try {
        await processManager.kill(botName as BotName);
        return { content: [{ type: "text", text: `Bot "${botName}" killed successfully` }] };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Failed to kill bot: ${detail}` }], isError: true };
      }
    }

    default:
      return { content: [{ type: "text", text: `Unknown meta tool: ${name}` }], isError: true };
  }
}
