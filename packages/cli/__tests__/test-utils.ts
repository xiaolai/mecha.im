import { vi } from "vitest";
import type { CommandDeps } from "../src/types.js";
import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";
import type { Sandbox } from "@mecha/sandbox";

export function makeDeps(opts: {
  mechaDir?: string;
  pm?: Partial<ProcessManager>;
  acl?: Partial<AclEngine>;
  sandbox?: Partial<Sandbox>;
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
    acl: {
      grant: vi.fn(),
      revoke: vi.fn(),
      check: vi.fn().mockReturnValue({ allowed: false, reason: "no_connect" }),
      listRules: vi.fn().mockReturnValue([]),
      listConnections: vi.fn().mockReturnValue([]),
      save: vi.fn(),
      ...opts.acl,
    } as unknown as AclEngine,
    sandbox: {
      platform: "macos",
      isAvailable: vi.fn().mockReturnValue(true),
      wrap: vi.fn(),
      describe: vi.fn().mockReturnValue("macOS sandbox-exec (available)"),
      ...opts.sandbox,
    } as unknown as Sandbox,
  };
}
