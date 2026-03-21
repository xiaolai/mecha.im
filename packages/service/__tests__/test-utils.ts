import { vi } from "vitest";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

export function makePm(list: ProcessInfo[] = []): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockImplementation((name: string) => list.find((p) => p.name === name)),
    list: vi.fn().mockReturnValue(list),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as ProcessManager;
}
