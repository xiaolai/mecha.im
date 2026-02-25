import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAclEngine } from "../../src/acl/engine.js";
import type { Capability } from "../../src/acl/types.js";

describe("ACL scenarios", () => {
  let mechaDir: string;
  const exposeMap: Record<string, Capability[]> = {};

  function makeEngine() {
    return createAclEngine({
      mechaDir,
      getExpose: (name) => exposeMap[name] ?? [],
    });
  }

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-acl-scen-"));
    for (const k of Object.keys(exposeMap)) delete exposeMap[k];
  });

  it("research team: bidirectional query", () => {
    exposeMap["coder"] = ["query"];
    exposeMap["researcher"] = ["query"];
    const acl = makeEngine();
    acl.grant("coder", "researcher", ["query"]);
    acl.grant("researcher", "coder", ["query"]);
    expect(acl.check("coder", "researcher", "query")).toEqual({ allowed: true });
    expect(acl.check("researcher", "coder", "query")).toEqual({ allowed: true });
  });

  it("read-only observer: can query all, nobody queries observer", () => {
    exposeMap["coder"] = ["query"];
    exposeMap["researcher"] = ["query"];
    exposeMap["observer"] = [];
    const acl = makeEngine();
    acl.grant("observer", "coder", ["query"]);
    acl.grant("observer", "researcher", ["query"]);
    expect(acl.check("observer", "coder", "query")).toEqual({ allowed: true });
    expect(acl.check("observer", "researcher", "query")).toEqual({ allowed: true });
    // Nobody can query observer (not exposed)
    acl.grant("coder", "observer", ["query"]);
    expect(acl.check("coder", "observer", "query")).toEqual({
      allowed: false,
      reason: "not_exposed",
    });
  });

  it("isolated CASA: no grants, no expose, no communication", () => {
    exposeMap["isolated"] = [];
    exposeMap["coder"] = ["query"];
    const acl = makeEngine();
    expect(acl.check("isolated", "coder", "query")).toEqual({
      allowed: false,
      reason: "no_connect",
    });
    expect(acl.check("coder", "isolated", "query")).toEqual({
      allowed: false,
      reason: "no_connect",
    });
  });

  it("hub-and-spoke: coordinator talks to all, workers cannot talk to each other", () => {
    exposeMap["coordinator"] = ["query"];
    exposeMap["worker-a"] = ["query", "execute"];
    exposeMap["worker-b"] = ["query", "execute"];
    const acl = makeEngine();

    // Coordinator can query both workers
    acl.grant("coordinator", "worker-a", ["query", "execute"]);
    acl.grant("coordinator", "worker-b", ["query", "execute"]);
    // Workers can report back to coordinator
    acl.grant("worker-a", "coordinator", ["query"]);
    acl.grant("worker-b", "coordinator", ["query"]);

    expect(acl.check("coordinator", "worker-a", "query")).toEqual({ allowed: true });
    expect(acl.check("coordinator", "worker-b", "execute")).toEqual({ allowed: true });
    expect(acl.check("worker-a", "coordinator", "query")).toEqual({ allowed: true });

    // Workers cannot talk to each other
    expect(acl.check("worker-a", "worker-b", "query")).toEqual({
      allowed: false,
      reason: "no_connect",
    });
    expect(acl.check("worker-b", "worker-a", "execute")).toEqual({
      allowed: false,
      reason: "no_connect",
    });
  });

  it("persistence: save and reload engine state", () => {
    exposeMap["a"] = ["query"];
    const acl = makeEngine();
    acl.grant("b", "a", ["query"]);
    acl.save();

    // Create a new engine from the same dir
    const acl2 = makeEngine();
    expect(acl2.check("b", "a", "query")).toEqual({ allowed: true });
    expect(acl2.listRules()).toHaveLength(1);
  });
});
