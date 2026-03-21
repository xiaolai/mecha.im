import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

describe("doctor command", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports healthy system with sandbox check", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-doctor-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });
    for (const sub of ["auth", "tools", "logs"]) mkdirSync(join(mechaDir, sub));
    writeFileSync(join(mechaDir, "node-id"), "test-id\n");

    // Add an auth profile so the auth-profiles check passes
    writeFileSync(join(mechaDir, "auth", "profiles.json"), JSON.stringify({
      default: "test",
      profiles: {
        test: { type: "api-key", account: null, label: "", tags: [], expiresAt: null, createdAt: "2026-01-01T00:00:00Z" },
      },
    }));
    writeFileSync(join(mechaDir, "auth", "credentials.json"), JSON.stringify({
      test: { token: "sk-ant-api03-test" },
    }));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "doctor"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("healthy"));
    // Sandbox check should appear in output (either as success or warn)
    const allCalls = [...(deps.formatter.success as ReturnType<typeof vi.fn>).mock.calls, ...(deps.formatter.warn as ReturnType<typeof vi.fn>).mock.calls];
    const sandboxMsg = allCalls.find((c: string[]) => c[0]?.includes("sandbox"));
    expect(sandboxMsg).toBeDefined();
  });

  it("reports unhealthy system", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-doctor-"));
    const mechaDir = join(tempDir, "nonexistent");

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "doctor"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("issues"));
  });
});
