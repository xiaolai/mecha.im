import { vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AclEngine } from "../src/acl/index.js";

export function makeAcl(overrides: Partial<AclEngine> = {}): AclEngine {
  return {
    grant: vi.fn(),
    revoke: vi.fn(),
    check: vi.fn().mockReturnValue({ allowed: true }),
    listRules: vi.fn().mockReturnValue([]),
    listConnections: vi.fn().mockReturnValue([]),
    save: vi.fn(),
    ...overrides,
  } as unknown as AclEngine;
}

export function writeBotConfig(mechaDir: string, name: string, cfg: Record<string, unknown>): void {
  const dir = join(mechaDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
}
