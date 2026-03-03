import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WebSocket } from "@fastify/websocket";
import type { ProcessManager, MechaPty, PtySpawnFn } from "@mecha/process";
import { buildCasaEnv, encodeProjectPath } from "@mecha/process";
import { readCasaConfig } from "@mecha/core";
import type { CasaName } from "@mecha/core";

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

export interface PtySession {
  id: string;
  casaName: string;
  pty: MechaPty;
  clients: Set<WebSocket>;
  createdAt: Date;
  lastActivity: Date;
  scrollback: string[];
}

export interface PtyManager {
  spawn(casaName: string, sessionId: string | undefined, cols: number, rows: number): PtySession;
  attach(sessionKey: string, ws: WebSocket): PtySession | null;
  detach(sessionKey: string, ws: WebSocket): void;
  resize(sessionKey: string, cols: number, rows: number): void;
  getSession(sessionKey: string): PtySession | null;
  /** Find all PTY sessions for a given CASA, sorted by most recently active first. */
  findByCasa(casaName: string): PtySession[];
  shutdown(): void;
}

export interface CreatePtyManagerOpts {
  processManager: ProcessManager;
  mechaDir: string;
  maxSessions?: number;
  idleTimeoutMs?: number;
  spawnFn: PtySpawnFn;
}

const DEFAULT_MAX_SESSIONS = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

export function createPtyManager(opts: CreatePtyManagerOpts): PtyManager {
  const {
    processManager, mechaDir, spawnFn,
    maxSessions = DEFAULT_MAX_SESSIONS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  } = opts;

  const sessions = new Map<string, PtySession>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    spawn(casaName, sessionId, cols, rows) {
      if (sessions.size >= maxSessions) {
        throw new Error(`Max PTY sessions (${maxSessions}) reached`);
      }

      const info = processManager.get(casaName as CasaName);
      if (!info || info.state !== "running") {
        throw new Error(`CASA "${casaName}" is not running`);
      }

      const casaDir = join(mechaDir, casaName);
      const config = readCasaConfig(casaDir);
      if (!config) {
        throw new Error(`Cannot read config for CASA "${casaName}"`);
      }

      // new-* IDs are mecha-internal (not real Claude Code session IDs).
      // Treat them as new sessions — don't pass --resume with a fake ID.
      const isNewSession = !sessionId || sessionId.startsWith("new-");
      const key = isNewSession
        ? `${casaName}:new-${randomBytes(8).toString("hex")}`
        : `${casaName}:${sessionId}`;
      const args: string[] = isNewSession ? [] : ["--resume", sessionId];

      // CASA filesystem paths — mirrors prepareCasaFilesystem() layout
      const homeDir = join(casaDir, "home");
      const tmpDir = join(casaDir, "tmp");
      const logsDir = join(casaDir, "logs");
      const projectsDir = join(homeDir, ".claude", "projects", encodeProjectPath(config.workspace));

      // Build sandboxed env via shared function (single source of truth with spawn)
      const casaEnv = buildCasaEnv({
        casaDir, homeDir, tmpDir, logsDir, projectsDir,
        workspacePath: config.workspace, port: config.port,
        token: config.token, name: casaName, mechaDir,
        auth: config.auth,
      });
      // PTY needs TERM for proper terminal rendering
      casaEnv.TERM = "xterm-256color";
      // Ensure ~/.local/bin is on PATH (common claude install location)
      const localBin = join(homedir(), ".local", "bin");
      if (casaEnv.PATH && !casaEnv.PATH.split(":").includes(localBin)) {
        casaEnv.PATH = `${localBin}:${casaEnv.PATH}`;
      }

      const claudeBin = resolveClaudeBin();
      const pty = spawnFn(claudeBin, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: config.workspace,
        env: casaEnv,
      });

      const scrollback: string[] = [];
      const session: PtySession = {
        id: key, casaName, pty, clients: new Set(),
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

    findByCasa(name) {
      const matches: PtySession[] = [];
      for (const s of sessions.values()) {
        if (s.casaName === name) matches.push(s);
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
