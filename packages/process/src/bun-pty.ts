import { spawn as nodeSpawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { MechaPty, PtySpawnFn, PtyDisposable } from "./pty-types.js";

/* v8 ignore start -- Bun runtime types not available at typecheck time */
declare const Bun: {
  spawn(cmd: string[], opts: {
    cwd?: string;
    env?: Record<string, string>;
    terminal: {
      cols: number;
      rows: number;
      name?: string;
      data?(terminal: BunTerminal, data: Uint8Array): void;
      exit?(terminal: BunTerminal, exitCode: number, signal: string | null): void;
    };
  }): BunSubprocess;
};

interface BunTerminal {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface BunSubprocess {
  terminal: BunTerminal;
  kill(signal?: number): void;
}
/* v8 ignore stop */

/* v8 ignore start -- runtime PTY code; tested via integration only */

declare global {
  var Bun: unknown;
}

/**
 * Creates a PtySpawnFn that works in both Bun and Node runtimes.
 * - In Bun: uses built-in PTY directly (no native addon)
 * - In Node: spawns a Bun subprocess as a PTY bridge
 */
export function createBunPtySpawn(): PtySpawnFn {
  if (typeof globalThis.Bun !== "undefined") {
    return createDirectBunPty();
  }
  return createBridgePty();
}

/** Direct Bun PTY — used when running inside Bun runtime. */
function createDirectBunPty(): PtySpawnFn {
  const decoder = new TextDecoder();

  return (file, args, opts): MechaPty => {
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(e: { exitCode: number; signal?: number }) => void>();

    const proc = Bun.spawn([file, ...args], {
      cwd: opts.cwd,
      env: { TERM: opts.name, ...opts.env },
      terminal: {
        cols: opts.cols,
        rows: opts.rows,
        name: opts.name,
        data(_terminal: BunTerminal, data: Uint8Array) {
          const str = decoder.decode(data, { stream: true });
          for (const cb of dataListeners) cb(str);
        },
        exit(_terminal: BunTerminal, exitCode: number, signal: string | null) {
          const e: { exitCode: number; signal?: number } = { exitCode };
          if (signal !== null) {
            const sigNum = signals[signal];
            if (sigNum !== undefined) e.signal = sigNum;
          }
          for (const cb of exitListeners) cb(e);
        },
      },
    });

    return {
      onData(cb): PtyDisposable {
        dataListeners.add(cb);
        return { dispose: () => { dataListeners.delete(cb); } };
      },
      onExit(cb): PtyDisposable {
        exitListeners.add(cb);
        return { dispose: () => { exitListeners.delete(cb); } };
      },
      write(data) { proc.terminal.write(data); },
      resize(cols, rows) { proc.terminal.resize(cols, rows); },
      kill() { proc.terminal.close(); },
    };
  };
}

/** Bridge PTY — used when running in Node; spawns Bun as a subprocess. */
function createBridgePty(): PtySpawnFn {
  // Resolve bridge script path relative to this compiled module
  const __filename = fileURLToPath(import.meta.url);
  const bridgeScript = join(dirname(__filename), "pty-bridge-script.js");

  return (file, args, opts): MechaPty => {
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(e: { exitCode: number; signal?: number }) => void>();

    const child = nodeSpawn("bun", ["run", bridgeScript], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line) as { type: string; data?: string; exitCode?: number; signal?: string | null; message?: string };
        switch (msg.type) {
          case "data": {
            const str = Buffer.from(msg.data!, "base64").toString("utf-8");
            for (const cb of dataListeners) cb(str);
            break;
          }
          case "exit": {
            const e: { exitCode: number; signal?: number } = { exitCode: msg.exitCode! };
            if (msg.signal) {
              const sigNum = signals[msg.signal];
              if (sigNum !== undefined) e.signal = sigNum;
            }
            for (const cb of exitListeners) cb(e);
            break;
          }
        }
      } catch {
        // Ignore unparseable lines
      }
    });

    // Send spawn command
    const spawnMsg = JSON.stringify({ type: "spawn", file, args, opts }) + "\n";
    child.stdin!.write(spawnMsg);

    return {
      onData(cb): PtyDisposable {
        dataListeners.add(cb);
        return { dispose: () => { dataListeners.delete(cb); } };
      },
      onExit(cb): PtyDisposable {
        exitListeners.add(cb);
        return { dispose: () => { exitListeners.delete(cb); } };
      },
      write(data) {
        child.stdin!.write(JSON.stringify({ type: "write", data }) + "\n");
      },
      resize(cols, rows) {
        child.stdin!.write(JSON.stringify({ type: "resize", cols, rows }) + "\n");
      },
      kill() {
        child.stdin!.write(JSON.stringify({ type: "kill" }) + "\n");
        setTimeout(() => child.kill(), 500);
      },
    };
  };
}

/** Common POSIX signal name → number mapping. */
const signals: Record<string, number> = {
  SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGTERM: 15, SIGKILL: 9,
};
/* v8 ignore stop */
