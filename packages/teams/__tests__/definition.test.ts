import { describe, it, expect } from "vitest";
import { validateTeamDef, parseTeamDef } from "../src/definition.js";
import type { TeamDef } from "../src/types.js";

const validDef: TeamDef = {
  name: "dev-team",
  bots: {
    developer: { cwd: "/project/src" },
    reviewer: { cwd: "/project" },
  },
  acl: [{ source: "developer", targets: ["reviewer"], capabilities: ["query"] }],
};

describe("validateTeamDef", () => {
  it("returns no errors for valid definition", () => {
    expect(validateTeamDef(validDef)).toEqual([]);
  });

  it("errors on missing name", () => {
    const errors = validateTeamDef({ ...validDef, name: "" });
    expect(errors).toContain("name is required and must be a string");
  });

  it("errors on no bots", () => {
    const errors = validateTeamDef({ ...validDef, bots: {} });
    expect(errors).toContain("at least one bot is required");
  });

  it("handles nullish bots via null coalescing fallback", () => {
    const def = { ...validDef, bots: null } as unknown as TeamDef;
    const errors = validateTeamDef(def);
    expect(errors).toContain("at least one bot is required");
  });

  it("errors on bot without cwd", () => {
    const errors = validateTeamDef({
      ...validDef,
      bots: { dev: { cwd: "" } },
    });
    expect(errors).toContain('bot "dev" requires a cwd');
  });

  it("errors on ACL referencing unknown bot", () => {
    const errors = validateTeamDef({
      ...validDef,
      acl: [{ source: "ghost", targets: ["reviewer"], capabilities: ["query"] }],
    });
    expect(errors).toContain('ACL source "ghost" is not a defined bot');
  });

  it("errors on ACL target referencing unknown bot", () => {
    const errors = validateTeamDef({
      ...validDef,
      acl: [{ source: "developer", targets: ["ghost"], capabilities: ["query"] }],
    });
    expect(errors).toContain('ACL target "ghost" is not a defined bot');
  });

  it("allows wildcard in ACL", () => {
    const errors = validateTeamDef({
      ...validDef,
      acl: [{ source: "*", targets: ["*"], capabilities: ["query"] }],
    });
    expect(errors).toEqual([]);
  });

  it("errors on non-object ACL rule", () => {
    const errors = validateTeamDef({
      ...validDef,
      acl: [null as unknown as TeamDef["acl"][0]],
    });
    expect(errors).toContain("ACL rule must be an object with source, targets, capabilities");
  });

  it("errors on ACL rule with non-string source", () => {
    const errors = validateTeamDef({
      ...validDef,
      acl: [{ source: 42 as unknown as string, targets: ["reviewer"], capabilities: ["query"] }],
    });
    expect(errors).toContain("ACL rule source must be a string");
  });

  it("errors on ACL rule with non-array targets", () => {
    const errors = validateTeamDef({
      ...validDef,
      acl: [{ source: "developer", targets: "reviewer" as unknown as string[], capabilities: ["query"] }],
    });
    expect(errors).toContain('ACL rule for source "developer" must have a targets array');
  });

  it("errors on ACL target that is not a string", () => {
    const errors = validateTeamDef({
      ...validDef,
      acl: [{ source: "developer", targets: [123 as unknown as string], capabilities: ["query"] }],
    });
    expect(errors).toContain("ACL target must be a string");
  });

  it("errors on schedule referencing unknown bot", () => {
    const errors = validateTeamDef({
      ...validDef,
      schedules: [{ bot: "ghost", id: "daily", every: "1h", prompt: "check" }],
    });
    expect(errors).toContain('Schedule "daily" references unknown bot "ghost"');
  });

  it("errors on schedule with invalid expression", () => {
    const errors = validateTeamDef({
      ...validDef,
      schedules: [{ bot: "developer", id: "bad", every: "nope", prompt: "check" }],
    });
    expect(errors).toContain('Schedule "bad" has invalid expression "nope"');
  });

  it("accepts valid schedules", () => {
    const errors = validateTeamDef({
      ...validDef,
      schedules: [
        { bot: "developer", id: "hourly", every: "1h", prompt: "run tests" },
        { bot: "reviewer", id: "cron-daily", every: "0 9 * * *", prompt: "review code" },
      ],
    });
    expect(errors).toEqual([]);
  });
});

describe("parseTeamDef", () => {
  it("parses a raw object", () => {
    const raw = {
      name: "test",
      bots: { a: { cwd: "/x" } },
    };
    const def = parseTeamDef(raw);
    expect(def.name).toBe("test");
    expect(def.bots.a?.cwd).toBe("/x");
  });

  it("throws on non-object", () => {
    expect(() => parseTeamDef(null)).toThrow("must be an object");
    expect(() => parseTeamDef("string")).toThrow("must be an object");
    expect(() => parseTeamDef(undefined)).toThrow("must be an object");
  });

  it("handles optional fields", () => {
    const def = parseTeamDef({ name: "minimal", bots: {} });
    expect(def.description).toBeUndefined();
    expect(def.home).toBeUndefined();
    expect(def.acl).toBeUndefined();
    expect(def.scaffold).toBeUndefined();
  });

  it("defaults bots to empty object when missing", () => {
    const def = parseTeamDef({ name: "no-bots" });
    expect(def.bots).toEqual({});
  });

  it("rejects invalid field types via Zod schema", () => {
    expect(() => parseTeamDef({ name: 42, bots: {} })).toThrow("Invalid team definition");
  });

  it("rejects bot with missing cwd via Zod schema", () => {
    expect(() => parseTeamDef({ name: "bad", bots: { a: {} } })).toThrow("Invalid team definition");
  });

  it("rejects invalid effort enum value", () => {
    expect(() => parseTeamDef({
      name: "bad-effort",
      bots: { a: { cwd: "/x", effort: "ultra" } },
    })).toThrow("Invalid team definition");
  });
});
