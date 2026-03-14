import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function ts(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

export function userLine(text: string, minutesAgo: number, uuid?: string): object {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
    uuid: uuid ?? randomUUID(),
    timestamp: ts(minutesAgo),
    sessionId: "", // filled per-session
  };
}

export function assistantLine(
  text: string,
  minutesAgo: number,
  opts?: { thinking?: string; model?: string; tokensIn?: number; tokensOut?: number },
): object {
  const content: object[] = [];
  if (opts?.thinking) {
    content.push({ type: "thinking", thinking: opts.thinking });
  }
  content.push({ type: "text", text });
  return {
    type: "assistant",
    message: {
      role: "assistant",
      model: opts?.model ?? "claude-sonnet-4-20250514",
      content,
      stop_reason: "end_turn",
      usage: {
        input_tokens: opts?.tokensIn ?? 1200,
        output_tokens: opts?.tokensOut ?? 350,
      },
    },
    timestamp: ts(minutesAgo),
  };
}

/** Assistant message that is a streaming chunk (stop_reason: null) — should be skipped */
export function assistantStreamChunk(text: string, minutesAgo: number): object {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text }],
      stop_reason: null,
    },
    timestamp: ts(minutesAgo),
  };
}

export function toolUseLine(
  name: string,
  input: unknown,
  minutesAgo: number,
  id?: string,
): { line: object; id: string } {
  const toolId = id ?? `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  return {
    id: toolId,
    line: {
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "tool_use", id: toolId, name, input }],
        stop_reason: "tool_use",
      },
      timestamp: ts(minutesAgo),
    },
  };
}

export function toolResultLine(toolUseId: string, content: string, minutesAgo: number): object {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: [{ type: "text", text: content }],
        },
      ],
    },
    timestamp: ts(minutesAgo),
  };
}

export function systemLine(minutesAgo: number): object {
  return { type: "system", timestamp: ts(minutesAgo) };
}

export function progressLine(minutesAgo: number): object {
  return {
    type: "progress",
    data: { type: "hook_progress", hookEvent: "SessionStart", hookName: "test" },
    timestamp: ts(minutesAgo),
  };
}

export function writeSession(fixturesDir: string, name: string, lines: object[]): string {
  const id = randomUUID();
  // Stamp sessionId into user lines
  const stamped = lines.map((l) => {
    const copy = { ...l } as Record<string, unknown>;
    if ((copy as { type?: string }).type === "user" && !("tool_use_id" in ((copy as { message?: { content?: { type?: string }[] } }).message?.content?.[0] ?? {}))) {
      copy.sessionId = id;
    }
    return copy;
  });
  const path = join(fixturesDir, `${id}.jsonl`);
  writeFileSync(path, stamped.map((l) => JSON.stringify(l)).join("\n") + "\n");
  console.log(`  ${name}: ${id}`);
  return id;
}
