/**
 * Mecha Telegram Adapter
 *
 * Bridges Telegram messages to mecha bots with:
 * - Real-time status updates (thinking, tool use, searching...)
 * - @bot mentions to route to specific bots
 * - Markdown/HTML rendering for Telegram
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=... MECHA_DEFAULT_BOT=orchestrator npx tsx index.ts
 *
 * Environment:
 *   TELEGRAM_BOT_TOKEN       — from @BotFather
 *   MECHA_DEFAULT_BOT        — default bot to route messages to (default: orchestrator)
 *   MECHA_URL                — mecha daemon URL (default: http://localhost:7700)
 *   MECHA_DASHBOARD_TOKEN    — dashboard bearer token for API access
 *   TELEGRAM_ALLOWED_USERS   — comma-separated Telegram user IDs (empty = allow all)
 */

import { Bot } from "grammy";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error("Set TELEGRAM_BOT_TOKEN environment variable");
  process.exit(1);
}

const DEFAULT_BOT = process.env.MECHA_DEFAULT_BOT ?? "orchestrator";
const MECHA_URL = process.env.MECHA_URL ?? "http://localhost:7700";
const DASHBOARD_TOKEN = process.env.MECHA_DASHBOARD_TOKEN ?? "";
const ALLOWED_USERS = process.env.TELEGRAM_ALLOWED_USERS?.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n)) ?? [];
const STATUS_UPDATE_INTERVAL_MS = 2000;

// ── Authenticated daemon fetch ──────────────────────────────

function mechaHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (DASHBOARD_TOKEN) h["Authorization"] = `Bearer ${DASHBOARD_TOKEN}`;
  return h;
}

// ── Bot registry ────────────────────────────────────────────

interface BotInfo { name: string; status: string }

async function listBots(): Promise<BotInfo[]> {
  try {
    const resp = await fetch(`${MECHA_URL}/api/bots`, { headers: mechaHeaders() });
    if (!resp.ok) return [];
    return await resp.json() as BotInfo[];
  } catch { return []; }
}

// ── Status formatting ───────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  thinking: "🧠", searching: "🔍", reading: "📖", writing: "✍️",
  editing: "📝", running: "⚡", calling: "📞", analyzing: "🔬",
  generating: "✨", default: "💭",
};

function formatStatus(tool: string | null, elapsed: number): string {
  if (!tool) return `${STATUS_ICONS.thinking} Thinking... (${elapsed}s)`;
  const lower = tool.toLowerCase();
  let icon = STATUS_ICONS.default;
  let label = tool;

  if (lower.includes("read") || lower.includes("grep") || lower.includes("glob")) { icon = STATUS_ICONS.reading; label = "Reading files"; }
  else if (lower.includes("write") || lower.includes("edit")) { icon = STATUS_ICONS.editing; label = "Editing code"; }
  else if (lower.includes("bash") || lower.includes("exec")) { icon = STATUS_ICONS.running; label = "Running command"; }
  else if (lower.includes("search") || lower.includes("web")) { icon = STATUS_ICONS.searching; label = "Searching"; }
  else if (lower.includes("agent") || lower.includes("task") || lower.includes("subtask")) { icon = STATUS_ICONS.calling; label = "Delegating to agent"; }
  else if (lower.includes("think")) { icon = STATUS_ICONS.thinking; label = "Thinking"; }

  return `${icon} ${label}... (${elapsed}s)`;
}

// ── Markdown to Telegram HTML ───────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mdToTelegramHtml(md: string): string {
  // Step 1: Extract code blocks and inline code to protect from other transforms
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  let html = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const escaped = escapeHtml(code.trimEnd());
    codeBlocks.push(lang ? `<pre><code class="language-${lang}">${escaped}</code></pre>` : `<pre>${escaped}</pre>`);
    return `\x00CB${idx}\x00`;
  });

  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // Step 2: Escape remaining HTML entities
  html = escapeHtml(html);

  // Step 3: Apply markdown transforms on escaped text
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    // Only allow http/https links
    if (/^https?:\/\//i.test(url)) return `<a href="${url}">${text}</a>`;
    return `${text} (${url})`;
  });
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "\n<b>$1</b>\n");
  html = html.replace(/^---+$/gm, "—————————");
  html = html.replace(/^&gt;\s?(.*)$/gm, "┃ <i>$1</i>");

  // Step 4: Restore code blocks and inline code
  html = html.replace(/\x00CB(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx)]);
  html = html.replace(/\x00IC(\d+)\x00/g, (_m, idx) => inlineCodes[parseInt(idx)]);

  return html.trim();
}

/** Truncate markdown BEFORE HTML conversion to avoid cutting tags */
function truncateContent(content: string, maxLen: number): { text: string; truncated: boolean } {
  if (content.length <= maxLen) return { text: content, truncated: false };
  return { text: content.slice(0, maxLen) + "\n\n... (truncated)", truncated: true };
}

// ── Extract target bot from @mention ────────────────────────

function extractTarget(text: string): { bot: string; message: string } {
  const match = text.match(/^@([a-z0-9][a-z0-9-]*)\s+([\s\S]+)/);
  if (match) return { bot: match[1], message: match[2] };
  return { bot: DEFAULT_BOT, message: text };
}

// ── Send prompt to bot via SSE ──────────────────────────────

interface PromptResult {
  content: string;
  cost?: number;
  duration?: number;
  sessionId?: string;
  error?: string;
}

async function sendPrompt(
  botName: string,
  message: string,
  onStatus: (status: string) => void,
): Promise<PromptResult> {
  const baseUrl = `${MECHA_URL}/bot/${encodeURIComponent(botName)}`;

  const resp = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mechaHeaders() },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });

  if (resp.status === 409) return { content: "", error: `Bot "${botName}" is busy.` };
  if (resp.status === 401) return { content: "", error: "Auth failed. Set MECHA_DASHBOARD_TOKEN." };
  if (!resp.ok) return { content: "", error: `Bot error: ${resp.status} ${resp.statusText}` };

  const reader = resp.body?.getReader();
  if (!reader) return { content: "", error: "No response body" };

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let cost: number | undefined;
  let duration: number | undefined;
  let sessionId: string | undefined;
  let error: string | undefined;

  function parseLine(line: string) {
    if (!line.startsWith("data: ")) return;
    try {
      const data = JSON.parse(line.slice(6));
      if (data.content) content += data.content;
      else if (data.summary) onStatus(formatStatus(data.summary, 0));
      else if (data.tool) onStatus(formatStatus(data.tool, 0));
      else if (data.thinking) onStatus(formatStatus("thinking", 0));
      else if (data.message && !data.task_id) error = data.message;
      else if (data.cost_usd !== undefined) {
        cost = data.cost_usd;
        duration = data.duration_ms;
        sessionId = data.session_id;
        if (data.success === false) error = "Query failed";
      }
    } catch { /* non-JSON */ }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) parseLine(line);
  }

  // Process remaining buffer (fix: don't drop final line)
  if (buffer) parseLine(buffer);

  return { content, cost, duration, sessionId, error };
}

// ── Telegram bot ────────────────────────────────────────────

const bot = new Bot(TELEGRAM_TOKEN);

// Global error handler
bot.catch((err) => {
  console.error("Telegram bot error:", err.message ?? err);
});

// Auth middleware
bot.use(async (ctx, next) => {
  if (ALLOWED_USERS.length > 0 && ctx.from && !ALLOWED_USERS.includes(ctx.from.id)) {
    await ctx.reply("⛔ Not authorized.");
    return;
  }
  await next();
});

// /start command
bot.command("start", async (ctx) => {
  const bots = await listBots();
  const botList = bots.length > 0
    ? bots.map(b => `• <b>${escapeHtml(b.name)}</b> (${escapeHtml(b.status)})`).join("\n")
    : "No bots running";

  await ctx.reply(
    `🤖 <b>Mecha Telegram Adapter</b>\n\n` +
    `Send a message to talk to <b>${escapeHtml(DEFAULT_BOT)}</b>.\n` +
    `Use <code>@botname message</code> to talk to a specific bot.\n\n` +
    `<b>Available bots:</b>\n${botList}\n\n` +
    `<b>Commands:</b>\n` +
    `• /bots — list available bots\n` +
    `• /status — fleet status`,
    { parse_mode: "HTML" },
  );
});

// /bots command
bot.command("bots", async (ctx) => {
  const bots = await listBots();
  if (bots.length === 0) {
    await ctx.reply("No bots found. Is the mecha daemon running?");
    return;
  }
  const lines = bots.map(b => {
    const icon = b.status === "running" ? "🟢" : "🔴";
    return `${icon} <b>${escapeHtml(b.name)}</b> — ${escapeHtml(b.status)}`;
  });
  await ctx.reply(`<b>Fleet Bots</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
});

// /status command
bot.command("status", async (ctx) => {
  try {
    const resp = await fetch(`${MECHA_URL}/api/health`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const health = await resp.json() as Record<string, unknown>;
    const bots = health.bots as { running: number; stopped: number };
    await ctx.reply(
      `<b>Fleet Status</b>\n\n` +
      `Version: <code>${escapeHtml(String(health.version))}</code>\n` +
      `Uptime: ${Math.floor((health.uptime as number) / 60)}m\n` +
      `Bots: 🟢 ${bots.running} running, 🔴 ${bots.stopped} stopped`,
      { parse_mode: "HTML" },
    );
  } catch {
    await ctx.reply("❌ Cannot reach mecha daemon.");
  }
});

// Message handler — forward to bot
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (!text) return;

  const { bot: targetBot, message } = extractTarget(text);
  const startTime = Date.now();

  let statusMsg: { message_id: number } | null = null;
  try {
    // Send initial status message
    statusMsg = await ctx.reply(
      `${STATUS_ICONS.thinking} Sending to <b>${escapeHtml(targetBot)}</b>...`,
      { parse_mode: "HTML" },
    );
  } catch {
    // Can't even send status — bail
    return;
  }

  let currentStatus = formatStatus(null, 0);
  let lastUpdate = Date.now();
  const statusInterval = setInterval(async () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const newStatus = currentStatus.replace(/\(\d+s\)/, `(${elapsed}s)`);
    if (Date.now() - lastUpdate >= STATUS_UPDATE_INTERVAL_MS) {
      try {
        await ctx.api.editMessageText(
          ctx.chat.id, statusMsg!.message_id,
          `🤖 <b>${escapeHtml(targetBot)}</b>\n${newStatus}`,
          { parse_mode: "HTML" },
        );
        lastUpdate = Date.now();
      } catch { /* rate limit or unchanged */ }
    }
  }, 1000);

  const typingInterval = setInterval(() => {
    ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
  }, 4000);
  ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});

  try {
    const result = await sendPrompt(targetBot, message, (status) => { currentStatus = status; });

    clearInterval(statusInterval);
    clearInterval(typingInterval);

    if (result.error) {
      try {
        await ctx.api.editMessageText(
          ctx.chat.id, statusMsg.message_id,
          `❌ <b>${escapeHtml(targetBot)}</b>: ${escapeHtml(result.error)}`,
          { parse_mode: "HTML" },
        );
      } catch { await ctx.reply(`❌ ${escapeHtml(result.error)}`).catch(() => {}); }
      return;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const footer = [
      result.cost !== undefined ? `$${result.cost.toFixed(4)}` : null,
      `${elapsed}s`,
    ].filter(Boolean).join(" · ");

    // Truncate BEFORE HTML conversion to avoid cutting tags
    const { text: truncated } = truncateContent(result.content, 3500);
    const responseHtml = mdToTelegramHtml(truncated);
    const fullMsg = `${responseHtml}\n\n<i>— ${escapeHtml(targetBot)} · ${footer}</i>`;

    try {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, fullMsg, { parse_mode: "HTML" });
    } catch {
      try {
        await ctx.reply(fullMsg, { parse_mode: "HTML" });
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      } catch {
        // HTML rendering failed — send as plain text
        await ctx.reply(truncated + `\n\n— ${targetBot} · ${footer}`).catch(() => {});
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      }
    }
  } catch (err) {
    clearInterval(statusInterval);
    clearInterval(typingInterval);
    try {
      await ctx.api.editMessageText(
        ctx.chat.id, statusMsg.message_id,
        `❌ Error: ${escapeHtml(err instanceof Error ? err.message : String(err))}`,
        { parse_mode: "HTML" },
      );
    } catch {
      await ctx.reply(`❌ Error: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    }
  }
});

// Start
console.log("Mecha Telegram Adapter starting...");
console.log(`  Default bot: ${DEFAULT_BOT}`);
console.log(`  Mecha URL: ${MECHA_URL}`);
console.log(`  Auth: ${DASHBOARD_TOKEN ? "token configured" : "no token (set MECHA_DASHBOARD_TOKEN)"}`);
console.log(`  Allowed users: ${ALLOWED_USERS.length > 0 ? ALLOWED_USERS.join(", ") : "all"}`);

bot.start({
  onStart: () => console.log("Telegram bot running — send a message to get started"),
});
