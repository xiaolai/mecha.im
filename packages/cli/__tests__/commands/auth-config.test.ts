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
    expect(deps.formatter.info).toHaveBeenCalledWith("TOTP:    enabled");
    expect(deps.formatter.info).toHaveBeenCalledWith("API key: disabled");
  });

  it("shows config in JSON mode", () => {
    const deps = makeDeps({ mechaDir: dir });
    (deps.formatter as any).isJson = true;
    executeAuthConfig({}, deps);
    expect(deps.formatter.json).toHaveBeenCalledWith({ totp: true, apiKey: false });
  });

  it("updates config with --totp flag", () => {
    const deps = makeDeps({ mechaDir: dir });
    // First enable API key so we can disable TOTP
    writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: true, apiKey: true }));
    executeAuthConfig({ totp: false }, deps);
    const config = JSON.parse(readFileSync(join(dir, "auth-config.json"), "utf-8"));
    expect(config).toEqual({ totp: false, apiKey: true });
    expect(deps.formatter.success).toHaveBeenCalledWith("Auth config updated");
  });

  it("updates config with --api-key flag", () => {
    const deps = makeDeps({ mechaDir: dir });
    executeAuthConfig({ apiKey: true }, deps);
    const config = JSON.parse(readFileSync(join(dir, "auth-config.json"), "utf-8"));
    expect(config).toEqual({ totp: true, apiKey: true });
  });

  it("shows inverted config (totp disabled, apiKey enabled)", () => {
    writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: false, apiKey: true }));
    const deps = makeDeps({ mechaDir: dir });
    executeAuthConfig({}, deps);
    expect(deps.formatter.info).toHaveBeenCalledWith("TOTP:    disabled");
    expect(deps.formatter.info).toHaveBeenCalledWith("API key: enabled");
  });

  it("shows disabled apiKey after update", () => {
    writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: true, apiKey: true }));
    const deps = makeDeps({ mechaDir: dir });
    executeAuthConfig({ apiKey: false }, deps);
    expect(deps.formatter.info).toHaveBeenCalledWith("API key: disabled");
  });

  it("throws when both methods would be disabled", () => {
    const deps = makeDeps({ mechaDir: dir });
    expect(() => executeAuthConfig({ totp: false, apiKey: false }, deps)).toThrow(
      "At least one auth method",
    );
  });
});
