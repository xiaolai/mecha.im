import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

afterEach(() => { process.exitCode = undefined as unknown as number; });

describe("acl command", () => {
  describe("grant", () => {
    it("grants a capability and saves", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "grant", "coder", "query", "researcher"]);
      expect(deps.acl.grant).toHaveBeenCalledWith("coder", "researcher", ["query"]);
      expect(deps.acl.save).toHaveBeenCalled();
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("coder → researcher (query)"),
      );
    });

    it("rejects invalid capability", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "grant", "coder", "fly", "researcher"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("fly"));
      expect(process.exitCode).toBe(2);
    });

    it("accepts name@node addresses", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "grant", "coder@alice", "query", "analyst@bob"]);
      expect(deps.acl.grant).toHaveBeenCalledWith("coder@alice", "analyst@bob", ["query"]);
    });

    it("rejects invalid address", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "grant", "../bad", "query", "analyst"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid address"));
      expect(process.exitCode).toBe(1);
    });

    it("rejects invalid target address", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "grant", "coder", "query", "BAD@NODE"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid address"));
      expect(process.exitCode).toBe(1);
    });
  });

  describe("revoke", () => {
    it("revokes a capability and saves", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "revoke", "coder", "query", "researcher"]);
      expect(deps.acl.revoke).toHaveBeenCalledWith("coder", "researcher", ["query"]);
      expect(deps.acl.save).toHaveBeenCalled();
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Revoked"),
      );
    });

    it("rejects invalid capability", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "revoke", "a", "invalid", "b"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("invalid"));
      expect(process.exitCode).toBe(2);
    });

    it("rejects invalid address in revoke", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "revoke", "../bad", "query", "researcher"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid address"));
      expect(process.exitCode).toBe(1);
    });

    it("rejects invalid target address in revoke", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "revoke", "coder", "query", "BAD"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid address"));
      expect(process.exitCode).toBe(1);
    });
  });

  describe("show", () => {
    it("shows all rules in a table", async () => {
      const deps = makeDeps({
        acl: {
          listRules: vi.fn().mockReturnValue([
            { source: "coder", target: "researcher", capabilities: ["query", "read_workspace"] },
          ]),
        },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "show"]);
      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["Source", "Target", "Capabilities"],
        [["coder", "researcher", "query, read_workspace"]],
      );
    });

    it("filters by bot name", async () => {
      const deps = makeDeps({
        acl: {
          listRules: vi.fn().mockReturnValue([
            { source: "coder", target: "researcher", capabilities: ["query"] },
            { source: "observer", target: "writer", capabilities: ["query"] },
          ]),
        },
      });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "show", "coder"]);
      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["Source", "Target", "Capabilities"],
        [["coder", "researcher", "query"]],
      );
    });

    it("shows message when no rules exist", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "show"]);
      expect(deps.formatter.info).toHaveBeenCalledWith("No ACL rules");
    });

    it("shows message when no rules for specific bot", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "show", "ghost"]);
      expect(deps.formatter.info).toHaveBeenCalledWith('No ACL rules for "ghost"');
    });
  });
});
