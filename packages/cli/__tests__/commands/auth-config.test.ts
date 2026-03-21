import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeDeps } from "../test-utils.js";
import { executeAuthConfig } from "../../src/commands/auth-config.js";

describe("auth-config command", () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "authcfg-cli-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); process.exitCode = undefined as unknown as number; });

  it("shows default config when no file exists", () => {
    const deps = makeDeps({ mechaDir: dir });
    executeAuthConfig({}, deps);
    expect(deps.formatter.info).toHaveBeenCalledWith("TOTP: enabled");
  });

  it("shows config in JSON mode", () => {
    const deps = makeDeps({ mechaDir: dir });
    (deps.formatter as any).isJson = true;
    executeAuthConfig({}, deps);
    expect(deps.formatter.json).toHaveBeenCalledWith({ totp: true });
  });

  it("updates config with --totp flag", () => {
    // Write config with totp: true, then re-enable (totp is required now)
    writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: true }));
    const deps = makeDeps({ mechaDir: dir });
    executeAuthConfig({ totp: true }, deps);
    const config = JSON.parse(readFileSync(join(dir, "auth-config.json"), "utf-8"));
    expect(config).toEqual({ totp: true });
    expect(deps.formatter.success).toHaveBeenCalledWith("Auth config updated");
  });

  it("throws when TOTP would be disabled", () => {
    const deps = makeDeps({ mechaDir: dir });
    expect(() => executeAuthConfig({ totp: false }, deps)).toThrow(
      "TOTP must be enabled",
    );
  });
});
