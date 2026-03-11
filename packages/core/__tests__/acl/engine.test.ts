import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAclEngine } from "../../src/acl/engine.js";
import type { Capability } from "../../src/acl/types.js";

describe("AclEngine", () => {
  let mechaDir: string;
  const exposeMap: Record<string, Capability[]> = {};

  function makeEngine() {
    return createAclEngine({
      mechaDir,
      getExpose: (name) => exposeMap[name] ?? [],
    });
  }

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-acl-"));
    // Reset expose map
    for (const k of Object.keys(exposeMap)) delete exposeMap[k];
  });

  describe("grant + check", () => {
    it("allows after grant when target exposes", () => {
      exposeMap["researcher"] = ["query"];
      const acl = makeEngine();
      acl.grant("coder", "researcher", ["query"]);
      expect(acl.check("coder", "researcher", "query")).toEqual({ allowed: true });
    });

    it("denies without grant (no_connect)", () => {
      exposeMap["researcher"] = ["query"];
      const acl = makeEngine();
      expect(acl.check("coder", "researcher", "query")).toEqual({
        allowed: false,
        reason: "no_connect",
      });
    });

    it("denies when granted but not exposed (not_exposed)", () => {
      exposeMap["researcher"] = []; // no expose
      const acl = makeEngine();
      acl.grant("coder", "researcher", ["query"]);
      expect(acl.check("coder", "researcher", "query")).toEqual({
        allowed: false,
        reason: "not_exposed",
      });
    });

    it("denies when exposed but no grant (no_connect)", () => {
      exposeMap["researcher"] = ["query", "read_workspace"];
      const acl = makeEngine();
      expect(acl.check("coder", "researcher", "read_workspace")).toEqual({
        allowed: false,
        reason: "no_connect",
      });
    });
  });

  describe("grant multiple capabilities", () => {
    it("each capability is checkable individually", () => {
      exposeMap["researcher"] = ["query", "read_workspace"];
      const acl = makeEngine();
      acl.grant("coder", "researcher", ["query", "read_workspace"]);
      expect(acl.check("coder", "researcher", "query")).toEqual({ allowed: true });
      expect(acl.check("coder", "researcher", "read_workspace")).toEqual({ allowed: true });
      expect(acl.check("coder", "researcher", "execute")).toEqual({
        allowed: false,
        reason: "no_connect",
      });
    });

    it("incremental grants merge capabilities", () => {
      exposeMap["researcher"] = ["query", "read_workspace"];
      const acl = makeEngine();
      acl.grant("coder", "researcher", ["query"]);
      acl.grant("coder", "researcher", ["read_workspace"]);
      const rules = acl.listRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]!.capabilities).toContain("query");
      expect(rules[0]!.capabilities).toContain("read_workspace");
    });
  });

  describe("revoke", () => {
    it("removes specific capability", () => {
      exposeMap["researcher"] = ["query", "read_workspace"];
      const acl = makeEngine();
      acl.grant("coder", "researcher", ["query", "read_workspace"]);
      acl.revoke("coder", "researcher", ["read_workspace"]);
      expect(acl.check("coder", "researcher", "query")).toEqual({ allowed: true });
      expect(acl.check("coder", "researcher", "read_workspace")).toEqual({
        allowed: false,
        reason: "no_connect",
      });
    });

    it("removes the rule entirely when all caps revoked", () => {
      const acl = makeEngine();
      acl.grant("coder", "researcher", ["query"]);
      acl.revoke("coder", "researcher", ["query"]);
      expect(acl.listRules()).toHaveLength(0);
    });

    it("no-ops when revoking nonexistent rule", () => {
      const acl = makeEngine();
      acl.revoke("coder", "researcher", ["query"]);
      expect(acl.listRules()).toHaveLength(0);
    });
  });

  describe("grant to self", () => {
    it("allows a bot to query itself", () => {
      exposeMap["coder"] = ["query"];
      const acl = makeEngine();
      acl.grant("coder", "coder", ["query"]);
      expect(acl.check("coder", "coder", "query")).toEqual({ allowed: true });
    });
  });

  describe("listRules", () => {
    it("returns a copy of all rules", () => {
      const acl = makeEngine();
      acl.grant("a", "b", ["query"]);
      acl.grant("c", "d", ["execute"]);
      const rules = acl.listRules();
      expect(rules).toHaveLength(2);
      // Verify it's a copy
      rules[0]!.capabilities.push("lifecycle");
      expect(acl.listRules()[0]!.capabilities).not.toContain("lifecycle");
    });
  });

  describe("name validation", () => {
    it("grant rejects invalid source name", () => {
      const acl = makeEngine();
      expect(() => acl.grant("../bad", "researcher", ["query"])).toThrow("Invalid address");
    });

    it("check rejects invalid target name", () => {
      const acl = makeEngine();
      expect(() => acl.check("coder", "../bad", "query")).toThrow("Invalid address");
    });

    it("revoke rejects invalid names", () => {
      const acl = makeEngine();
      expect(() => acl.revoke("../bad", "b", ["query"])).toThrow("Invalid address");
    });
  });

  describe("address-aware ACL (@node)", () => {
    it("grants and checks with target@node", () => {
      exposeMap["analyst@bob"] = ["query"];
      const acl = makeEngine();
      acl.grant("coder", "analyst@bob", ["query"]);
      expect(acl.check("coder", "analyst@bob", "query")).toEqual({ allowed: true });
    });

    it("grants and checks with source@node", () => {
      exposeMap["analyst"] = ["query"];
      const acl = makeEngine();
      acl.grant("coder@alice", "analyst", ["query"]);
      expect(acl.check("coder@alice", "analyst", "query")).toEqual({ allowed: true });
    });

    it("grants and checks with both source@node and target@node", () => {
      exposeMap["analyst@bob"] = ["query"];
      const acl = makeEngine();
      acl.grant("coder@alice", "analyst@bob", ["query"]);
      expect(acl.check("coder@alice", "analyst@bob", "query")).toEqual({ allowed: true });
    });

    it("rejects addresses with invalid node part", () => {
      const acl = makeEngine();
      expect(() => acl.grant("coder", "analyst@BAD", ["query"])).toThrow("Invalid address");
    });

    it("revokes address-based rules", () => {
      exposeMap["analyst@bob"] = ["query"];
      const acl = makeEngine();
      acl.grant("coder", "analyst@bob", ["query"]);
      acl.revoke("coder", "analyst@bob", ["query"]);
      expect(acl.listRules()).toHaveLength(0);
    });

    it("listConnections returns address targets", () => {
      const acl = makeEngine();
      acl.grant("coder", "analyst@bob", ["query"]);
      const conns = acl.listConnections("coder");
      expect(conns).toHaveLength(1);
      expect(conns[0].target).toBe("analyst@bob");
    });
  });

  describe("wildcard rules (R6-002)", () => {
    it("wildcard source grants access from any bot", () => {
      exposeMap["researcher"] = ["query"];
      const acl = makeEngine();
      acl.grant("*", "researcher", ["query"]);
      expect(acl.check("coder", "researcher", "query")).toEqual({ allowed: true });
      expect(acl.check("observer", "researcher", "query")).toEqual({ allowed: true });
    });

    it("wildcard target grants access to any bot", () => {
      exposeMap["researcher"] = ["query"];
      exposeMap["writer"] = ["query"];
      const acl = makeEngine();
      acl.grant("coder", "*", ["query"]);
      expect(acl.check("coder", "researcher", "query")).toEqual({ allowed: true });
      expect(acl.check("coder", "writer", "query")).toEqual({ allowed: true });
    });

    it("wildcard source still requires target to expose capability", () => {
      exposeMap["researcher"] = []; // no expose
      const acl = makeEngine();
      acl.grant("*", "researcher", ["query"]);
      expect(acl.check("coder", "researcher", "query")).toEqual({
        allowed: false,
        reason: "not_exposed",
      });
    });

    it("wildcard does not match when no rule exists", () => {
      exposeMap["researcher"] = ["query"];
      const acl = makeEngine();
      // No wildcard rule, no explicit rule
      expect(acl.check("coder", "researcher", "query")).toEqual({
        allowed: false,
        reason: "no_connect",
      });
    });

    it("revoke works on wildcard rules", () => {
      const acl = makeEngine();
      acl.grant("*", "researcher", ["query"]);
      acl.revoke("*", "researcher", ["query"]);
      expect(acl.listRules()).toHaveLength(0);
    });

    it("listConnections includes wildcard source rules", () => {
      const acl = makeEngine();
      acl.grant("*", "researcher", ["query"]);
      const conns = acl.listConnections("*");
      expect(conns).toHaveLength(1);
      expect(conns[0]!.target).toBe("researcher");
    });

    it("exact rule takes precedence over wildcard-source (insertion order independent)", () => {
      exposeMap["researcher"] = ["query", "read_workspace"];
      const acl = makeEngine();
      // Wildcard first, then exact — exact should still win
      acl.grant("*", "researcher", ["query"]);
      acl.grant("coder", "researcher", ["query", "read_workspace"]);
      // check should match the exact rule (has read_workspace)
      expect(acl.check("coder", "researcher", "read_workspace")).toEqual({ allowed: true });
      // A different source should still match via wildcard
      expect(acl.check("observer", "researcher", "read_workspace")).toEqual({
        allowed: false,
        reason: "no_connect",
      });
    });

    it("exact rule takes precedence when wildcard is added after exact", () => {
      exposeMap["researcher"] = ["query", "read_workspace"];
      const acl = makeEngine();
      // Exact first, then wildcard
      acl.grant("coder", "researcher", ["read_workspace"]);
      acl.grant("*", "researcher", ["query"]);
      // Exact rule should be found for coder (has read_workspace, not query)
      expect(acl.check("coder", "researcher", "read_workspace")).toEqual({ allowed: true });
      // Wildcard rule only has query — coder should match exact (no query in exact)
      expect(acl.check("coder", "researcher", "query")).toEqual({
        allowed: false,
        reason: "no_connect",
      });
    });

    it("wildcard target rule matched when no exact rule exists", () => {
      exposeMap["researcher"] = ["query"];
      const acl = makeEngine();
      acl.grant("coder", "*", ["query"]);
      expect(acl.check("coder", "researcher", "query")).toEqual({ allowed: true });
    });

    it("listConnections includes wildcard-source rules for concrete source", () => {
      const acl = makeEngine();
      acl.grant("*", "researcher", ["query"]);
      acl.grant("coder", "writer", ["execute"]);
      const conns = acl.listConnections("coder");
      expect(conns).toHaveLength(2);
      expect(conns.map((c) => c.target).sort()).toEqual(["researcher", "writer"]);
    });
  });

  describe("listConnections", () => {
    it("returns targets for a source", () => {
      const acl = makeEngine();
      acl.grant("coder", "researcher", ["query"]);
      acl.grant("coder", "writer", ["execute"]);
      acl.grant("observer", "coder", ["query"]);
      const conns = acl.listConnections("coder");
      expect(conns).toHaveLength(2);
      expect(conns.map((c) => c.target).sort()).toEqual(["researcher", "writer"]);
    });

    it("returns empty for unknown source", () => {
      const acl = makeEngine();
      expect(acl.listConnections("nobody")).toEqual([]);
    });
  });
});
