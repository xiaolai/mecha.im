import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SessionManager } from "../session.js";
import type { BotConfig } from "../types.js";
import { callBot } from "./mecha-call.js";
import { listBots } from "./mecha-list.js";
import { createFleetTools } from "./mecha-fleet.js";

export function createMechaToolServer(sessionManager: SessionManager, config?: BotConfig) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [
    tool(
      "mecha_new_session",
      "Start a new task/session. Call this when you want to begin a fresh conversation or when the current task is complete.",
      { summary: z.string().optional().describe("Summary of the completed task") },
      async (args) => {
        const { newTask, previousTask } = sessionManager.newSession(args.summary);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              new_task_id: newTask.id,
              previous_task: previousTask
                ? { id: previousTask.id, summary: previousTask.summary, status: "completed" }
                : null,
            }),
          }],
        };
      },
    ),

    tool(
      "mecha_call",
      "Call another mecha bot on the network and get its response. Use this to delegate tasks or ask questions to other specialized bots.",
      {
        bot: z.string().min(1).max(32).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/).describe("Target bot name"),
        message: z.string().min(1).max(50_000).describe("Message to send to the bot"),
      },
      async (args) => {
        const response = await callBot(args.bot, args.message);
        return {
          content: [{ type: "text" as const, text: response }],
        };
      },
    ),

    tool(
      "mecha_list",
      "List available mecha bots on the network. Shows bot names, IPs, and online status.",
      {},
      async () => {
        const bots = await listBots();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(bots, null, 2) }],
        };
      },
    ),
  ];

  // Register fleet tools only for orchestrator bots with fleet_control permission
  if (config?.permissions?.fleet_control) {
    tools.push(...createFleetTools());
  }

  return createSdkMcpServer({
    name: "mecha-tools",
    version: "1.0.0",
    tools,
  });
}
