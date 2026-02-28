import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import type { ProcessManager } from "@mecha/process";
import { readCasaConfig } from "@mecha/core";
import type { CasaName } from "@mecha/core";

export interface PtySession {
  id: string;
  casaName: string;
  pty: IPty;
  clients: Set<WebSocket>;
  createdAt: Date;
  lastActivity: Date;
}

export interface PtyManager {
  spawn(casaName: string, sessionId: string | undefined, cols: number, rows: number): PtySession;
  attach(sessionKey: string, ws: WebSocket): PtySession | null;
  detach(sessionKey: string, ws: WebSocket): void;
  resize(sessionKey: string, cols: number, rows: number): void;
  getSession(sessionKey: string): PtySession | null;
  listSessions(): PtySession[];
  shutdown(): void;
}

export type PtySpawnFn = (file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }) => IPty;

export interface CreatePtyManagerOpts {
  processManager: ProcessManager;
  mechaDir: string;
  maxSessions?: number;
  idleTimeoutMs?: number;
  /** Injected spawn function — required. Use node-pty's spawn in production. */
  spawnFn: PtySpawnFn;
}

const DEFAULT_MAX_SESSIONS = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 1_800_000; // 30 min

export function createPtyManager(opts: CreatePtyManagerOpts): PtyManager {
  const {
    processManager,
    mechaDir,
    maxSessions = DEFAULT_MAX_SESSIONS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  } = opts;

  const sessions = new Map<string, PtySession>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function makeSessionKey(casaName: string, sessionId: string | undefined): string {
    return sessionId ? `${casaName}:${sessionId}` : `${casaName}:new-${randomBytes(8).toString("hex")}`;
  }

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
    idleTimers.set(
      key,
      setTimeout(() => {
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
      }, idleTimeoutMs),
    );
  }

  function killSession(key: string): void {
    const session = sessions.get(key);
    /* v8 ignore start -- called from shutdown() which iterates existing keys */
    if (!session) {
      clearIdleTimer(key);
      return;
    }
    /* v8 ignore stop */
    session.pty.kill();
    sessions.delete(key);
    clearIdleTimer(key);
  }

  const spawnPty = opts.spawnFn;

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

      const key = makeSessionKey(casaName, sessionId);

      // Build claude args
      const args: string[] = [];
      if (sessionId) {
        args.push("--resume", sessionId);
      }

      // Build env from CASA config — filter out secrets
      const FILTERED_ENV_KEYS = new Set([
        "MECHA_OTP",
        "MECHA_SESSION_KEY",
      ]);
      const env: Record<string, string> = { TERM: "xterm-256color" };
      for (const [k, v] of Object.entries(process.env)) {
        /* v8 ignore start -- Object.entries filters out undefined values */
        if (v !== undefined && !FILTERED_ENV_KEYS.has(k)) {
          env[k] = v;
        }
        /* v8 ignore stop */
      }

      const pty = spawnPty("claude", args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: config.workspace,
        env,
      });

      const session: PtySession = {
        id: key,
        casaName,
        pty,
        clients: new Set(),
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      sessions.set(key, session);

      // Clean up on PTY exit
      pty.onExit(() => {
        sessions.delete(key);
        clearIdleTimer(key);
      });

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

    listSessions() {
      return [...sessions.values()];
    },

    shutdown() {
      for (const key of [...sessions.keys()]) {
        killSession(key);
      }
    },
  };
}
