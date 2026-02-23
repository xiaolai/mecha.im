import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessManager, MechaProcessInfo, SpawnOpts } from "@mecha/process";
import {
  mechaUp,
  mechaRm,
  mechaStart,
  mechaStop,
  mechaRestart,
  mechaLs,
  mechaStatus,
  mechaLogs,
  mechaConfigure,
  mechaDoctor,
  mechaInit,
  resolveUiUrl,
  resolveMcpEndpoint,
  mechaPrune,
} from "../src/service.js";
import {
  PathNotFoundError,
  PathNotDirectoryError,
  InvalidPermissionModeError,
  NoPortBindingError,
  ConfigureNoFieldsError,
} from "@mecha/contracts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { PassThrough } from "node:stream";

// --- Mock child_process for doctor ---
const mockExecFile = vi.fn();
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    execFile: (...a: unknown[]) => mockExecFile(...a),
  };
});
vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    promisify: () => (...a: unknown[]) => mockExecFile(...a),
  };
});

// --- ProcessManager mock ---
function createMockPM(overrides: Partial<ProcessManager> = {}): ProcessManager {
  const defaultInfo: MechaProcessInfo = {
    id: "mx-test-abc123" as any,
    pid: 12345,
    port: 7700,
    projectPath: tmpdir(),
    state: "running",
    authToken: "a".repeat(64),
    env: { MECHA_AUTH_TOKEN: "a".repeat(64) },
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    startFingerprint: "12345:0",
  };

  return {
    spawn: vi.fn<(opts: SpawnOpts) => Promise<MechaProcessInfo>>().mockResolvedValue(defaultInfo),
    stop: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    kill: vi.fn<(id: string, force?: boolean) => Promise<void>>().mockResolvedValue(undefined),
    get: vi.fn<(id: string) => MechaProcessInfo | undefined>().mockReturnValue(defaultInfo),
    list: vi.fn<() => MechaProcessInfo[]>().mockReturnValue([defaultInfo]),
    logs: vi.fn<(id: string) => NodeJS.ReadableStream>().mockReturnValue(new PassThrough()),
    getPortAndEnv: vi.fn<(id: string) => { port: number | undefined; env: Record<string, string> }>()
      .mockReturnValue({ port: 7700, env: { MECHA_AUTH_TOKEN: "a".repeat(64) } }),
    onEvent: vi.fn<(handler: (event: any) => void) => () => void>().mockReturnValue(() => {}),
    ...overrides,
  };
}

describe("mechaUp", () => {
  it("spawns process and returns result", async () => {
    const pm = createMockPM();
    const result = await mechaUp(pm, { projectPath: tmpdir() });

    expect(pm.spawn).toHaveBeenCalledTimes(1);
    expect(result.id).toBeDefined();
    expect(result.port).toBe(7700);
    expect(result.authToken).toHaveLength(64);
  });

  it("passes env vars to spawn", async () => {
    const pm = createMockPM();
    await mechaUp(pm, {
      projectPath: tmpdir(),
      claudeToken: "tok",
      anthropicApiKey: "sk-key",
      otp: "secret",
      permissionMode: "full-auto",
    });

    const opts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as SpawnOpts;
    expect(opts.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok");
    expect(opts.env?.ANTHROPIC_API_KEY).toBe("sk-key");
    expect(opts.env?.MECHA_OTP).toBe("secret");
    expect(opts.permissionMode).toBe("full-auto");
  });

  it("parses custom env entries", async () => {
    const pm = createMockPM();
    await mechaUp(pm, { projectPath: tmpdir(), env: ["MY_VAR=hello"] });

    const opts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as SpawnOpts;
    expect(opts.env?.MY_VAR).toBe("hello");
  });

  it("throws PathNotFoundError for non-existent path", async () => {
    const pm = createMockPM();
    await expect(mechaUp(pm, { projectPath: "/nonexistent/path" })).rejects.toThrow(PathNotFoundError);
  });

  it("throws PathNotDirectoryError for a file path", async () => {
    const pm = createMockPM();
    const testDir = join(tmpdir(), `mecha-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    const filePath = join(testDir, "file.txt");
    writeFileSync(filePath, "");

    await expect(mechaUp(pm, { projectPath: filePath })).rejects.toThrow(PathNotDirectoryError);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("throws for port below 1024 (schema validation)", async () => {
    const pm = createMockPM();
    await expect(mechaUp(pm, { projectPath: tmpdir(), port: 80 })).rejects.toThrow();
  });

  it("throws for invalid permission mode (schema validation)", async () => {
    const pm = createMockPM();
    await expect(mechaUp(pm, { projectPath: tmpdir(), permissionMode: "yolo" as any })).rejects.toThrow();
  });

  it("rejects blocked env keys via schema validation", async () => {
    const pm = createMockPM();
    await expect(
      mechaUp(pm, { projectPath: tmpdir(), env: ["MECHA_AUTH_TOKEN=hacked"] }),
    ).rejects.toThrow();
    expect(pm.spawn).not.toHaveBeenCalled();
  });
});

describe("mechaRm", () => {
  it("kills process", async () => {
    const pm = createMockPM();
    await mechaRm(pm, { id: "mx-foo", withState: false, force: false });
    expect(pm.kill).toHaveBeenCalledWith("mx-foo", false);
  });

  it("kills with force", async () => {
    const pm = createMockPM();
    await mechaRm(pm, { id: "mx-foo", withState: true, force: true });
    expect(pm.kill).toHaveBeenCalledWith("mx-foo", true);
  });
});

describe("mechaStart", () => {
  it("re-spawns from saved state", async () => {
    const pm = createMockPM();
    await mechaStart(pm, "mx-test-abc123");
    expect(pm.spawn).toHaveBeenCalledTimes(1);
  });

  it("throws when mecha not found", async () => {
    const pm = createMockPM({ get: vi.fn().mockReturnValue(undefined) });
    await expect(mechaStart(pm, "mx-nonexistent")).rejects.toThrow("Mecha not found");
  });
});

describe("mechaStop", () => {
  it("stops process by id", async () => {
    const pm = createMockPM();
    await mechaStop(pm, "mx-foo");
    expect(pm.stop).toHaveBeenCalledWith("mx-foo");
  });
});

describe("mechaRestart", () => {
  it("stops then starts process", async () => {
    const pm = createMockPM();
    await mechaRestart(pm, "mx-test-abc123");
    expect(pm.stop).toHaveBeenCalledWith("mx-test-abc123");
    expect(pm.spawn).toHaveBeenCalledTimes(1);
  });
});

describe("mechaLs", () => {
  it("returns formatted list items", async () => {
    const pm = createMockPM();
    const result = await mechaLs(pm);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("mx-test-abc123");
    expect(result[0].state).toBe("running");
    expect(result[0].port).toBe(7700);
  });

  it("handles empty list", async () => {
    const pm = createMockPM({ list: vi.fn().mockReturnValue([]) });
    const result = await mechaLs(pm);
    expect(result).toHaveLength(0);
  });

  it("formats stopped process with no port", async () => {
    const info = {
      id: "mx-stopped" as any, pid: undefined, port: 0,
      projectPath: "/tmp", state: "stopped" as const,
      authToken: "tok", env: {},
      createdAt: new Date().toISOString(), startFingerprint: "0:0",
    };
    const pm = createMockPM({ list: vi.fn().mockReturnValue([info]) });
    const result = await mechaLs(pm);
    expect(result[0].status).toBe("Stopped");
    expect(result[0].port).toBeUndefined();
  });
});

describe("mechaStatus", () => {
  it("returns status for running process", async () => {
    const pm = createMockPM();
    const result = await mechaStatus(pm, "mx-test-abc123");
    expect(result.id).toBe("mx-test-abc123");
    expect(result.running).toBe(true);
    expect(result.port).toBe(7700);
    expect(result.pid).toBe(12345);
  });

  it("throws when mecha not found", async () => {
    const pm = createMockPM({ get: vi.fn().mockReturnValue(undefined) });
    await expect(mechaStatus(pm, "mx-bad")).rejects.toThrow("Mecha not found");
  });

  it("returns undefined port when port is 0", async () => {
    const info = {
      id: "mx-noport" as any, pid: 123, port: 0,
      projectPath: "/tmp", state: "stopped" as const,
      authToken: "tok", env: {},
      createdAt: new Date().toISOString(), startFingerprint: "123:0",
    };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });
    const result = await mechaStatus(pm, "mx-noport");
    expect(result.port).toBeUndefined();
    expect(result.running).toBe(false);
  });
});

describe("mechaLogs", () => {
  it("returns log stream", async () => {
    const pm = createMockPM();
    const stream = await mechaLogs(pm, { id: "mx-foo", follow: false, tail: 50 });
    expect(stream).toBeDefined();
    expect(pm.logs).toHaveBeenCalledWith("mx-foo", { follow: false, tail: 50 });
  });
});

describe("mechaConfigure", () => {
  it("stops and re-spawns with new env", async () => {
    const pm = createMockPM();
    await mechaConfigure(pm, { id: "mx-test-abc123", claudeToken: "new-token" });

    expect(pm.stop).toHaveBeenCalledWith("mx-test-abc123");
    expect(pm.spawn).toHaveBeenCalledTimes(1);
    const opts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as SpawnOpts;
    expect(opts.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("new-token");
  });

  it("throws ConfigureNoFieldsError when no fields provided", async () => {
    const pm = createMockPM();
    await expect(mechaConfigure(pm, { id: "mx-foo" })).rejects.toThrow(ConfigureNoFieldsError);
  });

  it("throws InvalidPermissionModeError for invalid mode", async () => {
    const pm = createMockPM();
    await expect(mechaConfigure(pm, { id: "mx-foo", permissionMode: "nope" as any })).rejects.toThrow(InvalidPermissionModeError);
  });

  it("throws when mecha not found", async () => {
    const pm = createMockPM({ get: vi.fn().mockReturnValue(undefined) });
    await expect(mechaConfigure(pm, { id: "mx-bad", otp: "val" })).rejects.toThrow("Mecha not found");
  });

  it("clears env var when set to empty string", async () => {
    const info = {
      id: "mx-test-abc123" as any,
      pid: 12345,
      port: 7700,
      projectPath: tmpdir(),
      state: "running" as const,
      authToken: "tok",
      env: { MECHA_AUTH_TOKEN: "tok", CLAUDE_CODE_OAUTH_TOKEN: "existing" },
      createdAt: new Date().toISOString(),
      startFingerprint: "12345:0",
    };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });

    await mechaConfigure(pm, { id: "mx-test-abc123", claudeToken: "" });

    const opts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as SpawnOpts;
    expect(opts.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("sets and clears anthropicApiKey", async () => {
    const info = {
      id: "mx-test-abc123" as any, pid: 12345, port: 7700, projectPath: tmpdir(),
      state: "running" as const, authToken: "tok",
      env: { MECHA_AUTH_TOKEN: "tok", ANTHROPIC_API_KEY: "old-key" },
      createdAt: new Date().toISOString(), startFingerprint: "12345:0",
    };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });

    // Set new key
    await mechaConfigure(pm, { id: "mx-test-abc123", anthropicApiKey: "new-key" });
    let opts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as SpawnOpts;
    expect(opts.env?.ANTHROPIC_API_KEY).toBe("new-key");

    // Clear key
    vi.mocked(pm.spawn).mockClear();
    await mechaConfigure(pm, { id: "mx-test-abc123", anthropicApiKey: "" });
    opts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as SpawnOpts;
    expect(opts.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("sets and clears otp", async () => {
    const info = {
      id: "mx-test-abc123" as any, pid: 12345, port: 7700, projectPath: tmpdir(),
      state: "running" as const, authToken: "tok",
      env: { MECHA_AUTH_TOKEN: "tok", MECHA_OTP: "old-otp" },
      createdAt: new Date().toISOString(), startFingerprint: "12345:0",
    };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });

    // Set new otp
    await mechaConfigure(pm, { id: "mx-test-abc123", otp: "new-otp" });
    let opts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as SpawnOpts;
    expect(opts.env?.MECHA_OTP).toBe("new-otp");

    // Clear otp
    vi.mocked(pm.spawn).mockClear();
    await mechaConfigure(pm, { id: "mx-test-abc123", otp: "" });
    opts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as SpawnOpts;
    expect(opts.env?.MECHA_OTP).toBeUndefined();
  });

  it("sets permissionMode", async () => {
    const info = {
      id: "mx-test-abc123" as any, pid: 12345, port: 7700, projectPath: tmpdir(),
      state: "running" as const, authToken: "tok",
      env: { MECHA_AUTH_TOKEN: "tok", MECHA_PERMISSION_MODE: "plan" },
      createdAt: new Date().toISOString(), startFingerprint: "12345:0",
    };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });

    await mechaConfigure(pm, { id: "mx-test-abc123", permissionMode: "full-auto" });
    const opts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0] as SpawnOpts;
    expect(opts.env?.MECHA_PERMISSION_MODE).toBe("full-auto");
    expect(opts.permissionMode).toBe("full-auto");
  });
});

describe("mechaDoctor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns healthy when claude CLI and sandbox available", async () => {
    mockExecFile.mockResolvedValue({ stdout: "claude 1.0", stderr: "" });
    const result = await mechaDoctor();
    expect(result.claudeCliAvailable).toBe(true);
    expect(result.issues.length).toBeLessThanOrEqual(1); // sandbox check may vary
  });

  it("reports claude CLI unavailable", async () => {
    mockExecFile.mockRejectedValue(new Error("not found"));
    const result = await mechaDoctor();
    expect(result.claudeCliAvailable).toBe(false);
    expect(result.issues.some((i) => i.includes("Claude CLI"))).toBe(true);
  });

  it("reports sandbox unavailable on darwin when sandbox-exec fails", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExecFile
      .mockResolvedValueOnce({ stdout: "claude 1.0", stderr: "" }) // claude check
      .mockRejectedValueOnce(new Error("sandbox fail")); // sandbox check
    const result = await mechaDoctor();
    expect(result.sandboxSupported).toBe(false);
    expect(result.issues.some((i) => i.includes("sandbox"))).toBe(true);
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("reports sandbox supported on linux", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    mockExecFile.mockResolvedValueOnce({ stdout: "claude 1.0", stderr: "" });
    const result = await mechaDoctor();
    expect(result.sandboxSupported).toBe(true);
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("reports sandbox not supported on other platforms", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    mockExecFile.mockResolvedValueOnce({ stdout: "claude 1.0", stderr: "" });
    const result = await mechaDoctor();
    expect(result.sandboxSupported).toBe(false);
    expect(result.issues.some((i) => i.includes("win32"))).toBe(true);
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });
});

describe("mechaInit", () => {
  it("creates directories without error", async () => {
    await mechaInit();
    // Just verify it doesn't throw — creates ~/.mecha/* dirs
  });
});

describe("resolveUiUrl", () => {
  it("returns url with port", async () => {
    const pm = createMockPM();
    const result = await resolveUiUrl(pm, "mx-foo");
    expect(result.url).toBe("http://127.0.0.1:7700");
  });

  it("throws NoPortBindingError when no port", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: undefined, env: {} }),
    });
    await expect(resolveUiUrl(pm, "mx-foo")).rejects.toThrow(NoPortBindingError);
  });
});

describe("resolveMcpEndpoint", () => {
  it("returns endpoint with port and token", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({
        port: 7700,
        env: { MECHA_AUTH_TOKEN: "abc123" },
      }),
    });
    const result = await resolveMcpEndpoint(pm, "mx-foo");
    expect(result.endpoint).toBe("http://127.0.0.1:7700/mcp");
    expect(result.token).toBe("abc123");
  });

  it("returns undefined token when not in env", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: 7700, env: {} }),
    });
    const result = await resolveMcpEndpoint(pm, "mx-foo");
    expect(result.endpoint).toBe("http://127.0.0.1:7700/mcp");
    expect(result.token).toBeUndefined();
  });

  it("throws NoPortBindingError when no port", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: undefined, env: {} }),
    });
    await expect(resolveMcpEndpoint(pm, "mx-foo")).rejects.toThrow(NoPortBindingError);
  });
});

describe("mechaPrune", () => {
  it("removes stopped processes only", async () => {
    const stopped = { ...createMockPM().list()[0], state: "stopped" as any, id: "mx-a" as any };
    const running = { ...createMockPM().list()[0], state: "running" as any, id: "mx-b" as any };
    const pm = createMockPM({ list: vi.fn().mockReturnValue([stopped, running]) });

    const result = await mechaPrune(pm);
    expect(result.removedProcesses).toEqual(["mx-a"]);
    expect(pm.kill).toHaveBeenCalledTimes(1);
  });

  it("handles empty list", async () => {
    const pm = createMockPM({ list: vi.fn().mockReturnValue([]) });
    const result = await mechaPrune(pm);
    expect(result.removedProcesses).toEqual([]);
  });

  it("continues on kill errors (best effort)", async () => {
    const a = { ...createMockPM().list()[0], state: "exited" as any, id: "mx-a" as any };
    const b = { ...createMockPM().list()[0], state: "exited" as any, id: "mx-b" as any };
    const pm = createMockPM({
      list: vi.fn().mockReturnValue([a, b]),
      kill: vi.fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce(undefined),
    });
    const result = await mechaPrune(pm);
    expect(result.removedProcesses).toEqual(["mx-b"]);
  });
});
