import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return {
    ...actual,
    collectNodeInfo: vi.fn().mockReturnValue({
      hostname: "test-host.local",
      platform: "darwin",
      arch: "arm64",
      port: 0,
      uptimeSeconds: 8100,
      startedAt: "2026-03-02T12:00:00.000Z",
      botCount: 3,
      totalMemMB: 16384,
      freeMemMB: 8192,
      cpuCount: 10,
      lanIp: "10.0.0.125",
      tailscaleIp: "100.100.1.1",
      publicIp: "203.0.113.42",
    }),
    fetchPublicIp: vi.fn().mockResolvedValue("203.0.113.42"),
    formatUptime: actual.formatUptime,
  };
});

import { executeNodeInfo } from "../src/commands/node-info.js";
import { formatUptime } from "@mecha/core";

let deps: CommandDeps;

beforeEach(() => {
  vi.clearAllMocks();
  deps = makeDeps({
    pm: {
      list: vi.fn().mockReturnValue([
        { name: "a", state: "running", port: 7700, workspacePath: "/ws" },
        { name: "b", state: "stopped", workspacePath: "/ws2" },
      ]),
    },
  });
});

describe("executeNodeInfo", () => {
  it("outputs formatted node info with hostname, OS, and network", async () => {
    await executeNodeInfo(deps);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    const output = calls.join("\n");

    expect(output).toContain("Hostname:   test-host.local");
    expect(output).toContain("OS:         darwin arm64");
    expect(output).toContain("LAN:        10.0.0.125");
    expect(output).toContain("Tailscale:  100.100.1.1");
    expect(output).toContain("Public:     203.0.113.42");
    expect(output).toContain("CPUs:       10");
    expect(output).toContain("Memory:     16384 MB total / 8192 MB free");
    expect(output).toContain("bots:      3 running");
  });

  it("outputs uptime in formatted string", async () => {
    await executeNodeInfo(deps);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    const output = calls.join("\n");
    // 8100s = 2h 15m
    expect(output).toContain("Uptime:     2h 15m");
  });

  it("outputs JSON when formatter.isJson is true", async () => {
    Object.defineProperty(deps.formatter, "isJson", { value: true, writable: false });

    await executeNodeInfo(deps);

    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "test-host.local",
        platform: "darwin",
        cpuCount: 10,
      }),
    );
    expect(deps.formatter.info).not.toHaveBeenCalled();
  });

  it("shows dashes when network IPs are missing", async () => {
    const { collectNodeInfo } = await import("@mecha/core");
    (collectNodeInfo as ReturnType<typeof vi.fn>).mockReturnValue({
      hostname: "test-host.local",
      platform: "linux",
      arch: "x64",
      port: 0,
      uptimeSeconds: 60,
      startedAt: "2026-03-02T12:00:00.000Z",
      botCount: 0,
      totalMemMB: 8192,
      freeMemMB: 4096,
      cpuCount: 4,
    });

    await executeNodeInfo(deps);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    const output = calls.join("\n");
    expect(output).toContain("LAN:        —");
    expect(output).toContain("Tailscale:  —");
    expect(output).toContain("Public:     —");
  });
});

describe("formatUptime", () => {
  it("formats seconds to minutes", () => {
    expect(formatUptime(2700)).toBe("45m");
  });

  it("formats seconds to hours and minutes", () => {
    expect(formatUptime(8100)).toBe("2h 15m");
  });

  it("formats seconds to days and hours", () => {
    expect(formatUptime(277200)).toBe("3d 5h");
  });

  it("formats zero seconds", () => {
    expect(formatUptime(0)).toBe("0m");
  });

  it("formats exactly one hour", () => {
    expect(formatUptime(3600)).toBe("1h 0m");
  });

  it("formats exactly one day", () => {
    expect(formatUptime(86400)).toBe("1d 0h");
  });
});
