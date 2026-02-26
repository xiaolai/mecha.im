import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import { readNodes, addNode } from "@mecha/core";

describe("node commands", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cli-node-"));
  });
  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

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

    it("rejects invalid port", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.10", "--api-key", "k", "--port", "xyz"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
    });

    it("reports error for duplicate node name", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.10", "--api-key", "k"]);
      await program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.20", "--api-key", "k"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringMatching(/already registered/));
      expect(process.exitCode).toBe(1);
    });
  });

  describe("node rm", () => {
    it("removes an existing node", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.10", "--api-key", "k"]);
      await program.parseAsync(["node", "mecha", "node", "rm", "bob"]);
      expect(deps.formatter.success).toHaveBeenCalledWith("Node removed: bob");
      expect(readNodes(mechaDir)).toHaveLength(0);
    });

    it("reports error when node not found", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "rm", "ghost"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringMatching(/not found/));
      expect(process.exitCode).toBe(1);
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

    it("shows managed nodes with dashes for host/port", async () => {
      addNode(mechaDir, {
        name: "charlie",
        host: "",
        port: 0,
        apiKey: "",
        publicKey: "pk",
        fingerprint: "fp",
        managed: true,
        addedAt: "2026-01-01T00:00:00Z",
      });

      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "ls"]);
      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["Name", "Type", "Host", "Port", "Added"],
        expect.arrayContaining([
          expect.arrayContaining(["charlie", "managed", "\u2014", "\u2014"]),
        ]),
      );
    });

    it("shows table of registered nodes", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "add", "bob", "192.168.1.10", "--api-key", "k"]);
      await program.parseAsync(["node", "mecha", "node", "ls"]);
      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["Name", "Type", "Host", "Port", "Added"],
        expect.arrayContaining([
          expect.arrayContaining(["bob", "http", "192.168.1.10"]),
        ]),
      );
    });
  });
});
