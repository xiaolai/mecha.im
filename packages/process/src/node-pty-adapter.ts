import { createRequire } from "node:module";
import type { MechaPty, PtySpawnFn, PtySpawnOpts } from "./pty-types.js";

/* v8 ignore start -- runtime PTY code; tested via integration only */
const require = createRequire(import.meta.url);

/** Create a PtySpawnFn using node-pty. */
export function createNodePtySpawn(): PtySpawnFn {
  let nodePty: typeof import("node-pty");
  try {
    nodePty = require("node-pty") as typeof import("node-pty");
  } catch (err) {
    throw new Error(
      `Failed to load node-pty: ${err instanceof Error ? err.message : String(err)}. ` +
      `Install it with: npm install node-pty (requires a C++ compiler for native addon build)`,
    );
  }

  return (file: string, args: string[], opts: PtySpawnOpts): MechaPty => {
    const pty = nodePty.spawn(file, args, {
      name: opts.name,
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: opts.env,
    });

    return {
      onData(cb) {
        const disposable = pty.onData(cb);
        return { dispose: () => disposable.dispose() };
      },
      onExit(cb) {
        const disposable = pty.onExit(cb);
        return { dispose: () => disposable.dispose() };
      },
      write(data) {
        pty.write(data);
      },
      resize(cols, rows) {
        pty.resize(cols, rows);
      },
      kill(signal) {
        pty.kill(signal);
      },
    };
  };
}

/* v8 ignore stop */
