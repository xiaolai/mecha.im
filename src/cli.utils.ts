import { resolve } from "node:path";
import type { BotInfo } from "./docker.types.js";

/** Print a formatted table with header, separator, and rows */
export function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const formatRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  console.log(formatRow(header));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  rows.forEach((row) => console.log(formatRow(row)));
}

/** Set up Headscale container and save settings */
export async function setupHeadscale(settings: Record<string, unknown>): Promise<void> {
  console.log("Starting Headscale container...");
  const Docker = (await import("dockerode")).default;
  const d = new Docker();
  try {
    console.log("Pulling headscale image...");
    await d.pull("headscale/headscale:latest");
  } catch (err) {
    console.warn("Failed to pull headscale image (using cached if available):", err instanceof Error ? err.message : String(err));
  }
  const container = await d.createContainer({
    Image: "headscale/headscale:latest",
    name: "mecha-headscale",
    Cmd: ["serve"],
    ExposedPorts: { "8080/tcp": {} },
    HostConfig: {
      PortBindings: { "8080/tcp": [{ HostPort: "8080" }] },
      RestartPolicy: { Name: "unless-stopped" },
    },
  });
  await container.start();
  const execInst = await container.exec({ Cmd: ["headscale", "apikeys", "create"], AttachStdout: true });
  const stream = await execInst.start({ hijack: true, stdin: false });
  let apiKey = "";
  stream.on("data", (chunk: Buffer) => { apiKey += chunk.toString(); });
  await new Promise<void>((r) => stream.on("end", r));
  apiKey = apiKey.trim();

  const settingsPath = resolve(process.env.HOME ?? "~", ".mecha", "mecha.json");
  const { atomicWriteJson } = await import("../shared/atomic-write.js");
  atomicWriteJson(settingsPath, {
    ...settings,
    headscale_url: "http://localhost:8080",
    headscale_api_key: apiKey,
  });
  console.log(`Headscale running at http://localhost:8080`);
  console.log(`API key saved to ~/.mecha/mecha.json`);
}

/** Fetch remote bots from Headscale and merge with local list */
export async function fetchRemoteBots(
  localBots: BotInfo[],
  headscaleUrl: string,
  headscaleApiKey: string,
): Promise<BotInfo[]> {
  const remoteBots: BotInfo[] = [];
  try {
    const resp = await fetch(`${headscaleUrl}/api/v1/machine`, {
      headers: { Authorization: `Bearer ${headscaleApiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json() as {
        machines: Array<{ name: string; ipAddresses: string[]; online: boolean }>;
      };
      for (const m of data.machines) {
        if (!m.name.startsWith("mecha-")) continue;
        const name = m.name.replace(/^mecha-/, "");
        if (localBots.some((b) => b.name === name)) {
          const local = localBots.find((b) => b.name === name)!;
          (local as BotInfo & { ip: string; node: string }).ip = m.ipAddresses[0] ?? "";
          (local as BotInfo & { node: string }).node = "local";
          continue;
        }
        remoteBots.push({
          name,
          status: m.online ? "running" : "offline",
          model: "unknown",
          containerId: "remote",
          ports: "",
        });
      }
    }
  } catch {
    // Headscale not available
  }
  return remoteBots;
}

/** Read an SSE stream from a bot prompt response and print to stdout. Returns true on success. */
export async function readPromptSSE(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<boolean> {
  const decoder = new TextDecoder();
  let buffer = "";
  let success = true;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            process.stdout.write(parsed.content);
          } else if (parsed.summary) {
            process.stdout.write(`\n[tool] ${parsed.summary}\n`);
          } else if (parsed.message && !parsed.task_id) {
            console.error(`\nError: ${parsed.message}`);
            success = false;
          } else if (parsed.cost_usd !== undefined) {
            if (parsed.success === false) success = false;
            console.log(`\n\n---\nCost: $${parsed.cost_usd.toFixed(4)} | Duration: ${parsed.duration_ms}ms | Session: ${parsed.session_id}`);
          }
        } catch {
          // non-JSON data
        }
      }
    }
  }
  console.log();
  return success;
}
