import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withErrorHandler } from "../src/error-handler.js";
import { MechaError } from "@mecha/core";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

describe("withErrorHandler", () => {
  let deps: CommandDeps;

  beforeEach(() => {
    deps = makeDeps({});
  });

  afterEach(() => {
    process.exitCode = undefined as unknown as number;
  });

  it("runs the action successfully", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const result = await withErrorHandler(deps, fn);
    expect(result).toBeUndefined();
    expect(deps.formatter.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("catches MechaError and formats output", async () => {
    const err = new MechaError("test error", { code: "TEST", statusCode: 400, exitCode: 2 });
    await withErrorHandler(deps, async () => { throw err; });
    expect(deps.formatter.error).toHaveBeenCalledWith("test error");
    expect(process.exitCode).toBe(2);
  });

  it("re-throws non-MechaError errors", async () => {
    const err = new Error("unexpected");
    await expect(
      withErrorHandler(deps, async () => { throw err; }),
    ).rejects.toThrow("unexpected");
  });
});
