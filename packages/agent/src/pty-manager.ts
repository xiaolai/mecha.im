import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { WebSocket } from "@fastify/websocket";
import type { ProcessManager, MechaPty, PtySpawnFn } from "@mecha/process";
import { readCasaConfig } from "@mecha/core";
import type { CasaName } from "@mecha/core";

export interface PtySession {
  id: string;
  casaName: string;
  pty: MechaPty;
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
const DEFAULT_IDLE_TIMEOUT_MS = 1_800_000;

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

      const key = sessionId ? `${casaName}:${sessionId}` : `${casaName}:new-${randomBytes(8).toString("hex")}`;
      const args: string[] = sessionId ? ["--resume", sessionId] : [];

      // Build minimal env from CASA config — never spread process.env (leaks host secrets)
      const casaEnv: Record<string, string> = {
        TERM: "xterm-256color",
        /* v8 ignore start -- PATH/HOME always set in normal environments */
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME ?? "/tmp",
        /* v8 ignore stop */
        MECHA_CASA_NAME: casaName,
        MECHA_WORKSPACE: config.workspace,
        MECHA_PORT: String(config.port),
        MECHA_AUTH_TOKEN: config.token,
      };

      const pty = spawnFn("claude", args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: config.workspace,
        env: casaEnv,
      });

      const session: PtySession = {
        id: key, casaName, pty, clients: new Set(),
        createdAt: new Date(), lastActivity: new Date(),
      };
      sessions.set(key, session);

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

    shutdown() {
      for (const [key, session] of sessions) {
        session.pty.kill();
        clearIdleTimer(key);
      }
      sessions.clear();
    },
  };
}
