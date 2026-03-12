import { createRequire } from "node:module";
import type { MechaPty, PtySpawnFn, PtySpawnOpts } from "./pty-types.js";

const require = createRequire(import.meta.url);

/** Create a PtySpawnFn using node-pty. */
export function createNodePtySpawn(): PtySpawnFn {
  const nodePty = require("node-pty") as typeof import("node-pty");

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
