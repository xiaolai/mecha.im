/** Disposable subscription returned by onData/onExit. */
export interface PtyDisposable {
  dispose(): void;
}

/** Platform-agnostic PTY handle. */
export interface MechaPty {
  onData(cb: (data: string) => void): PtyDisposable;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): PtyDisposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

/** Options passed to a PTY spawn function. */
export interface PtySpawnOpts {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

/** Factory signature for spawning a PTY process. */
export type PtySpawnFn = (file: string, args: string[], opts: PtySpawnOpts) => MechaPty;
