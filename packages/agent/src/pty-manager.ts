import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WebSocket } from "@fastify/websocket";
import type { ProcessManager, MechaPty, PtySpawnFn } from "@mecha/process";
import { buildBotEnv, encodeProjectPath } from "@mecha/process";
import { readBotConfig } from "@mecha/core";
import type { BotName } from "@mecha/core";
import { buildClaudeArgs } from "./build-claude-args.js";

/** Resolve absolute path to `claude` binary, checking common install locations. */
function resolveClaudeBin(): string {
  const home = homedir();
  const candidates = [
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const p of candidates) {
    /* v8 ignore start -- binary location varies per machine */
    if (existsSync(p)) return p;
    /* v8 ignore stop */
  }
  /* v8 ignore start -- fallback when no candidate found */
  return "claude";
  /* v8 ignore stop */
}

/** Max chunks retained for scrollback replay on reattach. */
const SCROLLBACK_LIMIT = 200;

/** Active PTY session with its associated WebSocket clients and scrollback buffer. */
export interface PtySession {
  id: string;
  botName: string;
  pty: MechaPty;
  clients: Set<WebSocket>;
  createdAt: Date;
  lastActivity: Date;
  scrollback: string[];
}

/** Manages PTY sessions: spawning, attaching/detaching WebSocket clients, and cleanup. */
export interface PtyManager {
  spawn(botName: string, sessionId: string | undefined, cols: number, rows: number): PtySession;
  attach(sessionKey: string, ws: WebSocket): PtySession | null;
  detach(sessionKey: string, ws: WebSocket): void;
  resize(sessionKey: string, cols: number, rows: number): void;
  getSession(sessionKey: string): PtySession | null;
  /** Find all PTY sessions for a given bot, sorted by most recently active first. */
  findByBot(botName: string): PtySession[];
  shutdown(): void;
}

/** Options for creating a PtyManager instance. */
export interface CreatePtyManagerOpts {
  processManager: ProcessManager;
  mechaDir: string;
  maxSessions?: number;
  idleTimeoutMs?: number;
  /** Minimum milliseconds between spawns for the same bot. */
  spawnCooldownMs?: number;
  spawnFn: PtySpawnFn;
}

const DEFAULT_MAX_SESSIONS = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const DEFAULT_SPAWN_COOLDOWN_MS = 2_000;

/** Create a PtyManager that spawns Claude Code PTY sessions for bots with idle timeout and scrollback. */
export function createPtyManager(opts: CreatePtyManagerOpts): PtyManager {
  const {
    processManager, mechaDir, spawnFn,
    maxSessions = DEFAULT_MAX_SESSIONS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    spawnCooldownMs = DEFAULT_SPAWN_COOLDOWN_MS,
  } = opts;

  const sessions = new Map<string, PtySession>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastSpawnTime = new Map<string, number>();

  function clearIdleTimer(key: string): void {
    const timer = idleTimers.get(key);
    /* v8 ignore start -- no-op when no timer exists */
    if (!timer) return;
    /* v8 ignore stop */
    clearTimeout(timer);
    idleTimers.delete(key);
  }

  function startIdleTimer(key: string): void {
    clearIdleTimer(key);
    idleTimers.set(key, setTimeout(() => {
      const session = sessions.get(key);
      /* v8 ignore start -- race: PTY exited or client reattached before timer fires */
      if (!session || session.clients.size > 0) {
        idleTimers.delete(key);
        return;
      }
      /* v8 ignore stop */
      session.pty.kill();
      sessions.delete(key);
      idleTimers.delete(key);
    }, idleTimeoutMs));
  }

  return {
    spawn(botName, sessionId, cols, rows) {
      if (sessions.size >= maxSessions) {
        throw new Error(`Max PTY sessions (${maxSessions}) reached`);
      }

      // Rate limit: prevent rapid-fire PTY spawns for the same bot
      const now = Date.now();
      const lastSpawn = lastSpawnTime.get(botName);
      if (lastSpawn && now - lastSpawn < spawnCooldownMs) {
        throw new Error(`Too many spawn requests for "${botName}" — wait a moment`);
      }
      lastSpawnTime.set(botName, now);

      const info = processManager.get(botName as BotName);
      if (!info || info.state !== "running") {
        throw new Error(`bot "${botName}" is not running`);
      }

      const botDir = join(mechaDir, botName);
      const config = readBotConfig(botDir);
      if (!config) {
        throw new Error(`Cannot read config for bot "${botName}"`);
      }

      // new-* IDs are mecha-internal (not real Claude Code session IDs).
      // Treat them as new sessions — don't pass --resume with a fake ID.
      const isNewSession = !sessionId || sessionId.startsWith("new-");
      const key = isNewSession
        ? `${botName}:new-${randomBytes(8).toString("hex")}`
        : `${botName}:${sessionId}`;
      const args = buildClaudeArgs(config, sessionId ?? undefined);

      // bot filesystem paths — mirrors prepareBotFilesystem() layout
      // Use configured home if set, otherwise default to botDir
      const homeDir = config.home ?? botDir;
      const tmpDir = join(botDir, "tmp");
      const logsDir = join(botDir, "logs");
      const projectsDir = join(homeDir, ".claude", "projects", encodeProjectPath(config.workspace));

      // Build sandboxed env via shared function (single source of truth with spawn)
      const botEnv = buildBotEnv({
        botDir, homeDir, tmpDir, logsDir, projectsDir,
        workspacePath: config.workspace, port: config.port,
        token: config.token, name: botName, mechaDir,
        auth: config.auth,
      });
      // PTY needs TERM for proper terminal rendering
      botEnv.TERM = "xterm-256color";
      // Ensure ~/.local/bin is on PATH (common claude install location)
      const localBin = join(homedir(), ".local", "bin");
      if (botEnv.PATH && !botEnv.PATH.split(":").includes(localBin)) {
        botEnv.PATH = `${localBin}:${botEnv.PATH}`;
      }

      const claudeBin = resolveClaudeBin();
      const pty = spawnFn(claudeBin, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: config.workspace,
        env: botEnv,
      });

      const scrollback: string[] = [];
      const session: PtySession = {
        id: key, botName, pty, clients: new Set(),
        createdAt: new Date(), lastActivity: new Date(),
        scrollback,
      };
      sessions.set(key, session);

      // Capture PTY output into scrollback ring buffer for replay on reattach
      pty.onData((data) => {
        scrollback.push(data);
        if (scrollback.length > SCROLLBACK_LIMIT) scrollback.shift();
      });

      /* v8 ignore start -- PTY exit cleanup tested via mock emitter in pty-manager.test.ts */
      pty.onExit(() => {
        sessions.delete(key);
        clearIdleTimer(key);
      });
      /* v8 ignore stop */

      return session;
    },

    attach(sessionKey, ws) {
      const session = sessions.get(sessionKey);
      if (!session) return null;
      session.clients.add(ws);
      session.lastActivity = new Date();
      clearIdleTimer(sessionKey);
      return session;
    },

    detach(sessionKey, ws) {
      const session = sessions.get(sessionKey);
      if (!session) return;
      session.clients.delete(ws);
      if (session.clients.size === 0) {
        startIdleTimer(sessionKey);
      }
    },

    resize(sessionKey, cols, rows) {
      const session = sessions.get(sessionKey);
      if (!session) return;
      session.pty.resize(cols, rows);
      session.lastActivity = new Date();
    },

    getSession(sessionKey) {
      return sessions.get(sessionKey) ?? null;
    },

    findByBot(name) {
      const matches: PtySession[] = [];
      for (const s of sessions.values()) {
        if (s.botName === name) matches.push(s);
      }
      // Most recently active first
      matches.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
      return matches;
    },

    shutdown() {
      for (const [key, session] of sessions) {
        session.pty.kill();
        clearIdleTimer(key);
      }
      sessions.clear();
    },
  };
}
