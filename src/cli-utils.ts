import { resolve, join, basename } from "node:path";
import { existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import type { BotInfo } from "./docker.types.js";
import { isValidName } from "../shared/validation.js";

export function formatUptime(startedAtIso: string | undefined): string {
  if (!startedAtIso) return "-";
  const ms = Date.now() - new Date(startedAtIso).getTime();
  if (ms < 0 || isNaN(ms)) return "-";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function readCostsToday(botPath: string | undefined): string {
  if (!botPath) return "-";
  try {
    const costsPath = join(botPath, "costs.json");
    const raw = readFileSync(costsPath, "utf-8");
    const data = JSON.parse(raw) as { today?: number; daily?: Record<string, number> };
    // Current schema: { today, lifetime, daily: { "YYYY-MM-DD": cost } }
    const todayCost = data.today ?? 0;
    if (todayCost <= 0) return "$0.00";
    return `$${todayCost.toFixed(2)}`;
  } catch {
    return "-";
  }
}

export function requireValidName(name: string): asserts name is string {
  if (!isValidName(name)) {
    console.error(`Invalid bot name: "${name}"`);
    process.exit(1);
  }
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function collectAttachments(paths: string[]): string {
  const MAX_BYTES = 512 * 1024; // 512KB total limit
  let totalBytes = 0;
  const parts: string[] = [];

  function addFile(filePath: string, label: string) {
    if (totalBytes >= MAX_BYTES) return;
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) return;
      const raw = readFileSync(filePath);
      const remaining = MAX_BYTES - totalBytes;
      const trimmedBuf = raw.length > remaining ? raw.subarray(0, remaining) : raw;
      const trimmed = trimmedBuf.toString("utf-8");
      totalBytes += trimmedBuf.length;
      parts.push(`<file path="${escapeAttr(label)}">\n${trimmed}\n</file>`);
    } catch (err) {
      console.warn(`Warning: skipping unreadable file: ${filePath} (${err instanceof Error ? err.message : err})`);
    }
  }

  function walkDir(dirPath: string, base: string) {
    if (totalBytes >= MAX_BYTES) return;
    try {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        if (totalBytes >= MAX_BYTES) return;
        if (entry.name.startsWith(".")) continue;
        const full = join(dirPath, entry.name);
        const label = join(base, entry.name);
        if (entry.isDirectory()) walkDir(full, label);
        else addFile(full, label);
      }
    } catch (err) {
      console.warn(`Warning: skipping unreadable directory: ${dirPath} (${err instanceof Error ? err.message : err})`);
    }
  }

  for (const p of paths) {
    if (totalBytes >= MAX_BYTES) break;
    const abs = resolve(p);
    if (!existsSync(abs)) {
      console.error(`Attachment not found: ${abs}`);
      process.exit(1);
    }
    if (statSync(abs).isDirectory()) walkDir(abs, basename(abs));
    else addFile(abs, basename(abs));
  }

  if (totalBytes >= MAX_BYTES) {
    console.warn("Warning: attachments truncated at 512KB total");
  }
  return parts.join("\n\n");
}

// ── Table + SSE + Headscale helpers (merged from cli.utils.ts) ──

/** Print a formatted table with header, separator, and rows */
export function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const formatRow = (row: string[]) =>
    row.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  ");
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
    const pullStream = await d.pull("headscale/headscale:latest");
    // Follow pull progress to completion before creating container
    await new Promise<void>((resolve, reject) => {
      d.modem.followProgress(pullStream, (err: Error | null) => err ? reject(err) : resolve());
    });
  } catch (err) {
    console.warn("Failed to pull headscale image:", err instanceof Error ? err.message : String(err));
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
  // Use dockerode container exec API with Tty to avoid multiplexed framing bytes
  const e = await container.exec({ Cmd: ["headscale", "apikeys", "create"], AttachStdout: true, Tty: true });
  const stream = await e.start({ hijack: true, stdin: false });
  let apiKey = "";
  stream.on("data", (chunk: Buffer) => { apiKey += chunk.toString(); });
  await new Promise<void>((r) => stream.on("end", r));
  apiKey = apiKey.trim();

  const { getMechaDir } = await import("./store.js");
  const settingsPath = resolve(getMechaDir(), "mecha.json");
  const { atomicWriteJson } = await import("../shared/atomic-write.js");
  atomicWriteJson(settingsPath, {
    ...settings,
    headscale_url: "http://localhost:8080",
    headscale_api_key: apiKey,
  });
  console.log("Headscale running at http://localhost:8080");
  console.log("API key saved to ~/.mecha/mecha.json");
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
        remoteBots.push({ name, status: m.online ? "running" : "offline", model: "unknown", containerId: "remote", ports: "" });
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
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.content) process.stdout.write(parsed.content);
          else if (parsed.summary) process.stdout.write(`\n[tool] ${parsed.summary}\n`);
          else if (parsed.message && !parsed.task_id) { console.error(`\nError: ${parsed.message}`); success = false; }
          else if (parsed.cost_usd !== undefined) {
            if (parsed.success === false) success = false;
            console.log(`\n\n---\nCost: $${parsed.cost_usd.toFixed(4)} | Duration: ${parsed.duration_ms}ms | Session: ${parsed.session_id}`);
          }
        } catch { /* non-JSON SSE data */ }
      }
    }
  }
  // Process remaining buffer (fix: don't drop final partial line)
  if (buffer.startsWith("data: ")) {
    try {
      const parsed = JSON.parse(buffer.slice(6));
      if (parsed.cost_usd !== undefined) {
        if (parsed.success === false) success = false;
        console.log(`\n\n---\nCost: $${parsed.cost_usd.toFixed(4)} | Duration: ${parsed.duration_ms}ms | Session: ${parsed.session_id}`);
      }
    } catch { /* ignore */ }
  }
  console.log();
  return success;
}
