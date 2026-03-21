import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { CommandDeps } from "../../src/types.js";

// Mock child_process for git init
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn((...args: unknown[]) => {
      const cmd = args[0] as string;
      const cmdArgs = args[1] as string[];
      const opts = args[2] as { cwd: string; stdio: string };
      if (cmd === "git" && cmdArgs[0] === "init") {
        // Create a fake .git directory to simulate git init
        mkdirSync(join(opts.cwd, ".git"), { recursive: true });
        return Buffer.from("");
      }
      return actual.execFileSync(cmd, cmdArgs, opts);
    }),
  };
});

// Mock agentFetch and createSyncBundle for company sync
vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    agentFetch: vi.fn().mockResolvedValue({ status: 200 }),
  };
});

vi.mock("@mecha/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/connect")>();
  return {
    ...actual,
    createSyncBundle: vi.fn().mockReturnValue({
      files: { "config.json": Buffer.from("{}").toString("base64") },
    }),
  };
});

import { execFileSync } from "node:child_process";
import { agentFetch } from "@mecha/service";
import { createSyncBundle } from "@mecha/connect";

describe("company commands", () => {
  let mechaDir: string;
  let deps: CommandDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cli-company-"));
    deps = makeDeps({ mechaDir });
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  function run(args: string[]) {
    const program = createProgram(deps);
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    return program.parseAsync(["node", "mecha", ...args]);
  }

  describe("company init", () => {
    it("registers the company init subcommand", () => {
      const program = createProgram(deps);
      const companyCmd = program.commands.find((c) => c.name() === "company");
      expect(companyCmd).toBeDefined();
      const initCmd = companyCmd!.commands.find((c) => c.name() === "init");
      expect(initCmd).toBeDefined();
    });

    it("initializes a git repository in _company directory", async () => {
      await run(["company", "init"]);

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["init"],
        expect.objectContaining({
          cwd: join(mechaDir, "_company"),
        }),
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Company repository initialized"),
      );
    });

    it("skips init when already initialized", async () => {
      mkdirSync(join(mechaDir, "_company", ".git"), { recursive: true });

      await run(["company", "init"]);

      expect(execFileSync).not.toHaveBeenCalled();
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("already initialized"),
      );
    });

    it("errors when git init fails", async () => {
      (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("git not found");
      });

      await run(["company", "init"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to initialize git repository"),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe("company sync", () => {
    it("registers the company sync subcommand", () => {
      const program = createProgram(deps);
      const companyCmd = program.commands.find((c) => c.name() === "company");
      expect(companyCmd).toBeDefined();
      const syncCmd = companyCmd!.commands.find((c) => c.name() === "sync");
      expect(syncCmd).toBeDefined();
    });

    it("errors when company directory does not exist", async () => {
      await run(["company", "sync"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("not initialized"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors when no nodes are registered", async () => {
      mkdirSync(join(mechaDir, "_company"), { recursive: true });

      await run(["company", "sync"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("No registered nodes"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors when specified node is not found", async () => {
      mkdirSync(join(mechaDir, "_company"), { recursive: true });

      await run(["company", "sync", "--node", "ghost"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining('"ghost" not found'),
      );
      expect(process.exitCode).toBe(1);
    });

    it("shows not-implemented message for sync", async () => {
      mkdirSync(join(mechaDir, "_company"), { recursive: true });
      writeFileSync(join(mechaDir, "_company", "test.txt"), "data");
      writeFileSync(join(mechaDir, "nodes.json"), JSON.stringify([
        { name: "s1", host: "10.0.0.1", port: 7660, apiKey: "k", addedAt: "2026-01-01T00:00:00Z" },
      ]));

      await run(["company", "sync"]);

      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("not yet implemented"),
      );
    });
  });
});
