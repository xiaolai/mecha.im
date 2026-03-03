/**
 * Bun PTY bridge — runs as a Bun subprocess, communicates via stdin/stdout JSON lines.
 *
 * Protocol (parent → bridge, via stdin):
 *   {"type":"spawn","file":"claude","args":[],"opts":{"name":"xterm-256color","cols":80,"rows":24,"cwd":"/tmp","env":{}}}
 *   {"type":"write","data":"ls\r"}
 *   {"type":"resize","cols":120,"rows":40}
 *   {"type":"kill"}
 *
 * Protocol (bridge → parent, via stdout):
 *   {"type":"data","data":"<base64>"}
 *   {"type":"exit","exitCode":0,"signal":null}
 *   {"type":"error","message":"..."}
 */

/* v8 ignore start -- Bun-only bridge script */
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
  }): { terminal: BunTerminal; kill(signal?: number): void };
};

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

interface BunTerminal {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

let terminal: BunTerminal | null = null;

const decoder = new TextDecoder();
let lineBuf = "";

process.stdin.on("data", (chunk: Buffer) => {
  lineBuf += chunk.toString();
  const lines = lineBuf.split("\n");
  lineBuf = lines.pop()!;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (e) {
      send({ type: "error", message: `Parse error: ${(e as Error).message}` });
    }
  }
});

function handleMessage(msg: { type: string; [k: string]: unknown }): void {
  switch (msg.type) {
    case "spawn": {
      const file = msg.file as string;
      const args = msg.args as string[];
      const opts = msg.opts as { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> };

      try {
        const proc = Bun.spawn([file, ...args], {
          cwd: opts.cwd,
          env: { TERM: opts.name, ...opts.env },
          terminal: {
            cols: opts.cols,
            rows: opts.rows,
            name: opts.name,
            data(_t: BunTerminal, data: Uint8Array) {
              // Use streaming TextDecoder to handle multi-byte chars split across chunks
              const str = decoder.decode(data, { stream: true });
              if (str) send({ type: "data", data: Buffer.from(str).toString("base64") });
            },
            exit(_t: BunTerminal, exitCode: number, signal: string | null) {
              send({ type: "exit", exitCode, signal });
              terminal = null;
              // Give parent time to read, then exit
              setTimeout(() => process.exit(0), 100);
            },
          },
        });
        terminal = proc.terminal;
        send({ type: "ready" });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      }
      break;
    }
    case "write": {
      if (terminal) terminal.write(msg.data as string);
      break;
    }
    case "resize": {
      if (terminal) terminal.resize(msg.cols as number, msg.rows as number);
      break;
    }
    case "kill": {
      if (terminal) {
        send({ type: "exit", exitCode: 0, signal: "SIGTERM" });
        terminal.close();
        terminal = null;
      }
      setTimeout(() => process.exit(0), 100);
      break;
    }
  }
}

// Keep alive
process.stdin.resume();
/* v8 ignore stop */
