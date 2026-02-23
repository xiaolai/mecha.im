import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaChat, mechaSessionCreate, mechaSessionMessage } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

function processSSELine(line: string): void {
  if (!line.startsWith("data: ") || line.startsWith("data: [DONE]")) return;
  try {
    const data = JSON.parse(line.slice(6));
    const text = data?.content ?? data?.text ?? data?.delta?.text ?? "";
    if (text) process.stdout.write(text);
  } catch { /* skip non-JSON lines */ }
}

async function streamSSEResponse(res: Response, formatter: { info: (msg: string) => void }): Promise<void> {
  const body = res.body;
  if (!body) {
    formatter.info("(empty response)");
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedDone = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.startsWith("data: [DONE]")) {
        receivedDone = true;
        break;
      }
      processSSELine(line);
    }
    if (receivedDone) break;
  }
  // Flush remaining buffer
  if (buffer.trim()) processSSELine(buffer);
  process.stdout.write("\n");
}

export function registerChatCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("chat <id> <message>")
    .description("Send a chat message to a running Mecha")
    .option("-s, --session <sessionId>", "Send message to an existing session")
    .option("-n, --new-session", "Create a new session and send the message")
    .action(async (id: string, message: string, opts: { session?: string; newSession?: boolean }) => {
      const { processManager, formatter } = deps;
      try {
        if (opts.session && opts.newSession) {
          formatter.error("Cannot use --session and --new-session together");
          process.exitCode = 1;
          return;
        }
        if (opts.session) {
          // Send to existing session
          const res = await mechaSessionMessage(processManager, { id, sessionId: opts.session, message });
          await streamSSEResponse(res, formatter);
        } else if (opts.newSession) {
          // Create session, then send first message
          const session = await mechaSessionCreate(processManager, { id }) as { sessionId: string };
          formatter.info(`Session: ${session.sessionId}`);
          const res = await mechaSessionMessage(processManager, { id, sessionId: session.sessionId, message });
          await streamSSEResponse(res, formatter);
        } else {
          // Stateless (unchanged behavior)
          const res = await mechaChat(processManager, { id, message });
          await streamSSEResponse(res, formatter);
        }
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
