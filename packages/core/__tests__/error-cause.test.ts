import { describe, it, expect } from "vitest";
import {
  MechaError,
  ProcessSpawnError,
  CasaNotFoundError,
  AclDeniedError,
} from "../src/errors.js";

describe("MechaError cause chain", () => {
  it("preserves cause when provided", () => {
    const original = new Error("ECONNREFUSED");
    const err = new MechaError("spawn failed", {
      code: "TEST",
      statusCode: 500,
      exitCode: 2,
      cause: original,
    });
    expect(err.cause).toBe(original);
  });

  it("has no cause when not provided", () => {
    const err = new MechaError("no cause", {
      code: "TEST",
      statusCode: 500,
      exitCode: 1,
    });
    expect(err.cause).toBeUndefined();
  });

  it("factory errors accept optional cause as last argument", () => {
    const original = new Error("connection refused");
    const err = new ProcessSpawnError("binary not found", { cause: original });
    expect(err.message).toBe("Failed to spawn CASA: binary not found");
    expect(err.cause).toBe(original);
    expect(err.code).toBe("PROCESS_SPAWN_ERROR");
  });

  it("factory errors work without cause (backward compatible)", () => {
    const err = new CasaNotFoundError("alice");
    expect(err.message).toContain("alice");
    expect(err.cause).toBeUndefined();
  });

  it("multi-arg factory errors accept cause as extra last argument", () => {
    const original = new TypeError("bad input");
    const err = new AclDeniedError("coder", "query", "researcher", { cause: original });
    expect(err.message).toContain("coder cannot query researcher");
    expect(err.cause).toBe(original);
  });
});
