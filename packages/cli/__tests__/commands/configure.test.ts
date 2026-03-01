import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessInfo } from "@mecha/process";
import type { CasaName } from "@mecha/core";

describe("configure command", () => {
  let mechaDir: string;
  afterEach(() => {
    if (mechaDir) rmSync(mechaDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  it("updates tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const casaDir = join(mechaDir, "alice");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "alice", "--tags", "research,papers"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["research", "papers"]);
  });

  it("shows nothing-to-update when no flags provided", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "alice"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("Nothing to update");
  });

  it("rejects invalid tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "alice", "--tags", "has space"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("invalid characters"));
    expect(process.exitCode).toBe(1);

  });

  it("writes config even when existing config is corrupt", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const casaDir = join(mechaDir, "alice");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), "not-json{{{");

    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "alice", "--tags", "new-tag"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["new-tag"]);
  });

  it("handles CasaNotFoundError via withErrorHandler", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "unknown", "--tags", "foo"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  it("updates expose capabilities", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const casaDir = join(mechaDir, "alice");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "alice", "--expose", "query,read_workspace"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.expose).toEqual(["query", "read_workspace"]);
  });

  it("rejects invalid capability", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "alice", "--expose", "invalid_cap"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid capability"));
    expect(process.exitCode).toBe(1);

  });

  it("updates both tags and expose together", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const casaDir = join(mechaDir, "alice");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "alice", "--tags", "dev", "--expose", "query"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["dev"]);
    expect(cfg.expose).toEqual(["query"]);
  });

  it("sets auth profile on CASA", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    // Create auth profile first
    const authDir = join(mechaDir, "auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, "profiles.json"), JSON.stringify({
      default: "personal",
      profiles: { personal: { type: "oauth", account: null, label: "", tags: [], expiresAt: null, createdAt: "2025-01-01T00:00:00Z" } },
    }));
    writeFileSync(join(authDir, "credentials.json"), JSON.stringify({ personal: { token: "tok" } }));

    const casaDir = join(mechaDir, "alice");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "alice", "--auth", "personal"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.auth).toBe("personal");
  });

  it("rejects unknown auth profile", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    mkdirSync(join(mechaDir, "auth"), { recursive: true });
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "configure", "alice", "--auth", "nonexistent"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });
});
