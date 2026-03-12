import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import { homedir } from "node:os";
import type { WebSocket } from "ws";
import type { MechaPty, PtySpawnFn } from "./pty-types.js";
import type { BotConfig } from "./types.js";
import { log } from "../shared/logger.js";

/** Resolve absolute path to `claude` binary. */
function resolveClaudeBin(): string {
  const home = homedir();
  const candidates = [
    join(home, ".npm-global", "bin", "claude"),
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "claude";
}

const SCROLLBACK_LIMIT = 200;
const SCROLLBACK_MAX_BYTES = 512 * 1024;
const MIN_COLS = 10;
const MAX_COLS = 500;
const MIN_ROWS = 2;
const MAX_ROWS = 200;

export interface PtySession {
  id: string;
  claudeSessionId: string;
  pty: MechaPty;
  clients: Set<WebSocket>;
  createdAt: Date;
  lastActivity: Date;
  scrollback: string[];
}

export interface PtyManager {
  spawn(sessionId: string | undefined, cols: number, rows: number): PtySession;
  attach(sessionKey: string, ws: WebSocket): PtySession | null;
  detach(sessionKey: string, ws: WebSocket): void;
  resize(sessionKey: string, cols: number, rows: number): void;
  getSession(sessionKey: string): PtySession | null;
  listSessions(): Array<{ id: string; claudeSessionId: string; createdAt: string }>;
  shutdown(): void;
}

export interface CreatePtyManagerOpts {
  spawnFn: PtySpawnFn;
  botConfig: BotConfig;
  maxSessions?: number;
  idleTimeoutMs?: number;
  spawnCooldownMs?: number;
}

export function createPtyManager(opts: CreatePtyManagerOpts): PtyManager {
  const {
    spawnFn,
    botConfig,
    maxSessions = 10,
    idleTimeoutMs = 300_000,
    spawnCooldownMs = 2_000,
  } = opts;

  const sessions = new Map<string, PtySession>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let lastSpawnTime = 0;

  function clearIdleTimer(key: string): void {
    const timer = idleTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    idleTimers.delete(key);
  }

  function startIdleTimer(key: string): void {
    clearIdleTimer(key);
    idleTimers.set(key, setTimeout(() => {
      const session = sessions.get(key);
      if (!session || session.clients.size > 0) {
        idleTimers.delete(key);
        return;
      }
      log.info(`PTY session ${key} idle timeout — killing`);
      session.pty.kill();
      sessions.delete(key);
      idleTimers.delete(key);
    }, idleTimeoutMs));
  }

  // Build env for claude CLI — inherit process env + set TERM
  function buildPtyEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    env.TERM = "xterm-256color";
    // Ensure user bin dirs are on PATH
    const home = homedir();
    const extraPaths = [
      join(home, ".npm-global", "bin"),
      join(home, ".local", "bin"),
    ];
    for (const p of extraPaths) {
      if (env.PATH && !env.PATH.split(delimiter).includes(p)) {
        env.PATH = `${p}${delimiter}${env.PATH}`;
      }
    }
    return env;
  }

  return {
    spawn(sessionId, cols, rows) {
      if (sessions.size >= maxSessions) {
        throw new Error(`Max PTY sessions (${maxSessions}) reached`);
      }

      const now = Date.now();
      if (now - lastSpawnTime < spawnCooldownMs) {
        throw new Error("Too many spawn requests — wait a moment");
      }

      const isNewSession = !sessionId || sessionId.startsWith("new-");
      const claudeSessionId = isNewSession ? randomUUID() : sessionId;
      const key = claudeSessionId;

      // Kill existing session with same key
      const existing = sessions.get(key);
      if (existing) {
        existing.pty.kill();
        clearIdleTimer(key);
        sessions.delete(key);
      }

      // Build claude CLI args from bot config
      const args: string[] = [];
      if (isNewSession) {
        args.push("--session-id", claudeSessionId);
      } else {
        args.push("--resume", claudeSessionId);
      }

      // Permission mode — bypass permissions skips interactive trust/accept prompts
      if (botConfig.permission_mode === "bypassPermissions") {
        args.push("--dangerously-skip-permissions", "--allow-dangerously-skip-permissions");
      } else if (botConfig.permission_mode && botConfig.permission_mode !== "default") {
        args.push("--permission-mode", botConfig.permission_mode);
      }

      // Model
      if (botConfig.model) {
        args.push("--model", botConfig.model);
      }

      const safeCols = Math.max(MIN_COLS, Math.min(MAX_COLS, cols));
      const safeRows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, rows));

      const cwd = process.env.MECHA_WORKSPACE_CWD
        || (existsSync("/home/appuser/workspace") ? "/home/appuser/workspace" : "/state/home-workspace");

      const claudeBin = resolveClaudeBin();
      log.info(`Spawning PTY: ${claudeBin} ${args.join(" ")} (${safeCols}x${safeRows})`);

      const pty = spawnFn(claudeBin, args, {
        name: "xterm-256color",
        cols: safeCols,
        rows: safeRows,
        cwd,
        env: buildPtyEnv(),
      });

      lastSpawnTime = now;

      const scrollback: string[] = [];
      let scrollbackBytes = 0;
      const session: PtySession = {
        id: key,
        claudeSessionId,
        pty,
        clients: new Set(),
        createdAt: new Date(),
        lastActivity: new Date(),
        scrollback,
      };
      sessions.set(key, session);

      // Capture PTY output into scrollback ring buffer
      pty.onData((data) => {
        session.lastActivity = new Date();
        scrollback.push(data);
        scrollbackBytes += Buffer.byteLength(data, "utf8");
        while (scrollback.length > SCROLLBACK_LIMIT || scrollbackBytes > SCROLLBACK_MAX_BYTES) {
          const removed = scrollback.shift();
          if (removed) scrollbackBytes -= Buffer.byteLength(removed, "utf8");
          else break;
        }
      });

      pty.onExit(({ exitCode }) => {
        log.info(`PTY session ${key} exited with code ${exitCode}`);
        sessions.delete(key);
        clearIdleTimer(key);
      });

      return session;
    },

    attach(sessionKey, ws) {
      const session = sessions.get(sessionKey);
      if (!session) return null;
      // Single-client model: disconnect previous clients
      for (const old of session.clients) {
        old.close(4001, "Replaced by new client");
      }
      session.clients.clear();
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
      const safeCols = Math.max(MIN_COLS, Math.min(MAX_COLS, cols));
      const safeRows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, rows));
      session.pty.resize(safeCols, safeRows);
      session.lastActivity = new Date();
    },

    getSession(sessionKey) {
      return sessions.get(sessionKey) ?? null;
    },

    listSessions() {
      return Array.from(sessions.values()).map((s) => ({
        id: s.id,
        claudeSessionId: s.claudeSessionId,
        createdAt: s.createdAt.toISOString(),
      }));
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
