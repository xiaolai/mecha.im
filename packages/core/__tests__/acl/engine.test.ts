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
