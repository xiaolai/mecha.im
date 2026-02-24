import { vi } from "vitest";
import type { CommandDeps } from "../src/types.js";
import type { ProcessManager } from "@mecha/process";

export function makeDeps(opts: {
  mechaDir?: string;
  pm?: Partial<ProcessManager>;
} = {}): CommandDeps {
  return {
    formatter: {
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      json: vi.fn(),
      table: vi.fn(),
    },
    processManager: {
      spawn: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      list: vi.fn().mockReturnValue([]),
      stop: vi.fn(),
      kill: vi.fn(),
      logs: vi.fn(),
      getPortAndToken: vi.fn().mockReturnValue(undefined),
      onEvent: vi.fn().mockReturnValue(() => {}),
      ...opts.pm,
    } as unknown as ProcessManager,
    mechaDir: opts.mechaDir ?? "/tmp/mecha",
  };
}
