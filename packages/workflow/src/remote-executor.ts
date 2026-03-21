import type { StepExecutor } from "./types.js";

/** Function that chats with a local bot (matches botChat signature). */
export type LocalChatFn = (opts: {
  bot: string;
  prompt: string;
  sessionId?: string;
}) => Promise<{ response: string; costUsd: number }>;

/** Function that sends a request to a remote node (matches agentFetch pattern). */
export type RemoteFetchFn = (opts: {
  node: { name: string; host: string; port: number; apiKey: string };
  path: string;
  method: string;
  body: unknown;
  allowPrivateHosts?: boolean;
}) => Promise<Response>;

/** Function that resolves a node name to its entry. */
export type NodeLookupFn = (
  nodeName: string,
) => { name: string; host: string; port: number; apiKey: string } | undefined;

/** Options for creating a remote-capable step executor. */
export interface RemoteExecutorOpts {
  localChat: LocalChatFn;
  remoteFetch: RemoteFetchFn;
  nodeLookup: NodeLookupFn;
}

/**
 * Create a StepExecutor that routes steps to local or remote bots.
 *
 * If `bot` contains `@node` (e.g., `developer@spark01`), the step is
 * sent to the remote node via agentFetch. Otherwise, it executes
 * locally via botChat.
 */
export function createRemoteExecutor(opts: RemoteExecutorOpts): StepExecutor {
  const { localChat, remoteFetch, nodeLookup } = opts;

  return async ({ bot, prompt, stepRunId, timeout, budgetUsd }) => {
    // Check for remote routing: bot@node format
    const atIndex = bot.indexOf("@");
    if (atIndex === -1) {
      // Local execution
      const result = await localChat({
        bot,
        prompt,
        sessionId: stepRunId,
      });
      return { output: result.response, costUsd: result.costUsd };
    }

    // Remote execution: parse bot@node
    const botName = bot.slice(0, atIndex);
    const nodeName = bot.slice(atIndex + 1);

    const node = nodeLookup(nodeName);
    if (!node) {
      throw new Error(`Remote node "${nodeName}" not found for bot "${botName}@${nodeName}"`);
    }

    const body: Record<string, unknown> = {
      message: prompt,
      sessionId: stepRunId,
    };
    if (timeout) body.timeout = timeout;
    if (budgetUsd !== undefined) body.budgetUsd = budgetUsd;

    const response = await remoteFetch({
      node,
      path: `/bots/${encodeURIComponent(botName)}/query`,
      method: "POST",
      body,
      allowPrivateHosts: true,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Remote bot "${botName}@${nodeName}" returned HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      response?: string;
      text?: string;
      sessionId?: string;
      costUsd?: number;
    };

    return {
      output: data.response ?? data.text ?? "",
      costUsd: data.costUsd,
    };
  };
}
