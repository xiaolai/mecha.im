import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeTotpSetup, executeTotpVerify } from "../src/commands/dashboard-totp.js";
import { createFormatter } from "../src/formatter.js";
import type { CommandDeps } from "../src/types.js";
import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";

vi.mock("otpauth", () => {
  const mockSecret = {
    base32: "JBSWY3DPEHPK3PXP",
  };
  return {
    Secret: class {
      base32: string;
      constructor() { this.base32 = mockSecret.base32; }
      static fromBase32(s: string) { return { base32: s }; }
    },
    TOTP: class {
      private opts: Record<string, unknown>;
      constructor(opts: Record<string, unknown>) { this.opts = opts; }
      toString() { return `otpauth://totp/mecha:dashboard?secret=${(this.opts.secret as { base32: string }).base32}&algorithm=SHA1&digits=6&period=30`; }
      validate({ token }: { token: string; window: number }) {
        return token === "123456" ? 0 : null;
      }
    },
  };
});

vi.mock("qrcode", () => ({
  toString: vi.fn().mockResolvedValue("█████████"),
}));

function makeDeps(overrides?: Partial<CommandDeps>): CommandDeps {
  return {
    formatter: createFormatter({ quiet: true }),
    processManager: {} as unknown as ProcessManager,
    mechaDir: "/tmp/mecha-test",
    acl: {} as unknown as AclEngine,
    sandbox: {} as never,
    ...overrides,
  };
}

describe("executeTotpSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("generates secret and prints QR code + env var", async () => {
    const deps = makeDeps();
    const successSpy = vi.spyOn(deps.formatter, "success");
    const infoSpy = vi.spyOn(deps.formatter, "info");

    await executeTotpSetup(deps);

    expect(successSpy).toHaveBeenCalledWith("TOTP secret generated");
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("MECHA_OTP="));
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("otpauth://"));
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("█████████"));
  });
});

describe("executeTotpVerify", () => {
  const originalEnv = process.env.MECHA_OTP;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    delete process.env.MECHA_OTP;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MECHA_OTP = originalEnv;
    } else {
      delete process.env.MECHA_OTP;
    }
  });

  it("errors when MECHA_OTP not set", async () => {
    const deps = makeDeps();
    const errorSpy = vi.spyOn(deps.formatter, "error");

    await executeTotpVerify("123456", deps);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("MECHA_OTP not set"));
  });

  it("succeeds with valid code", async () => {
    process.env.MECHA_OTP = "JBSWY3DPEHPK3PXP";
    const deps = makeDeps();
    const successSpy = vi.spyOn(deps.formatter, "success");

    await executeTotpVerify("123456", deps);

    expect(successSpy).toHaveBeenCalledWith("Valid ✓");
    expect(process.exitCode).toBeUndefined();
  });

  it("fails with invalid code", async () => {
    process.env.MECHA_OTP = "JBSWY3DPEHPK3PXP";
    const deps = makeDeps();
    const errorSpy = vi.spyOn(deps.formatter, "error");

    await executeTotpVerify("000000", deps);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("Invalid ✗");
  });
});
