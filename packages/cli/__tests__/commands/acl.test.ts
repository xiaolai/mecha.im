import { describe, it, expect, vi } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

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

      await expect(
        program.parseAsync(["node", "mecha", "acl", "grant", "coder", "fly", "researcher"]),
      ).rejects.toThrow("fly");
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

      await expect(
        program.parseAsync(["node", "mecha", "acl", "revoke", "a", "invalid", "b"]),
      ).rejects.toThrow("invalid");
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

    it("filters by CASA name", async () => {
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

    it("shows message when no rules for specific CASA", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "acl", "show", "ghost"]);
      expect(deps.formatter.info).toHaveBeenCalledWith('No ACL rules for "ghost"');
    });
  });
});
