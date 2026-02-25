import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import { readNodes } from "@mecha/core";

describe("node commands", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cli-node-"));
  });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  describe("node init", () => {
    it("initializes with auto-generated name", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "init"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Node initialized"),
      );
    });

    it("initializes with explicit name", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "init", "--name", "alice"]);
      expect(deps.formatter.success).toHaveBeenCalledWith("Node initialized: alice");
    });

    it("reports already initialized on second call", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "init", "--name", "alice"]);
      await program.parseAsync(["node", "mecha", "node", "init"]);
      expect(deps.formatter.info).toHaveBeenCalledWith("Node already initialized: alice");
    });
  });

  describe("node add", () => {
    it("adds a peer node", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.10", "--api-key", "key123"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Node added: bob"),
      );

      const nodes = readNodes(mechaDir);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe("bob");
      expect(nodes[0].host).toBe("192.168.1.10");
    });

    it("rejects duplicate node name", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.10"]);
      await expect(
        program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.20"]),
      ).rejects.toThrow(/already registered/);
    });
  });

  describe("node rm", () => {
    it("removes an existing node", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.10"]);
      await program.parseAsync(["node", "mecha", "node", "rm", "bob"]);
      expect(deps.formatter.success).toHaveBeenCalledWith("Node removed: bob");
      expect(readNodes(mechaDir)).toHaveLength(0);
    });

    it("throws when node not found", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await expect(
        program.parseAsync(["node", "mecha", "node", "rm", "ghost"]),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("node ls", () => {
    it("shows message when no nodes", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "ls"]);
      expect(deps.formatter.info).toHaveBeenCalledWith("No peer nodes registered");
    });

    it("shows table of registered nodes", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.10"]);
      await program.parseAsync(["node", "mecha", "node", "ls"]);
      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["Name", "Host", "Port", "Added"],
        expect.arrayContaining([
          expect.arrayContaining(["bob", "192.168.1.10"]),
        ]),
      );
    });
  });
});
