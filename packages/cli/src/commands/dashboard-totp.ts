import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";

/** Execute the TOTP setup flow. */
export async function executeTotpSetup(deps: CommandDeps): Promise<void> {
  const { TOTP, Secret } = await import("otpauth");
  const qrcode = await import("qrcode");

  const secret = new Secret({ size: 20 });
  const base32 = secret.base32;

  const totp = new TOTP({
    issuer: "mecha",
    label: "dashboard",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  const otpauthUrl = totp.toString();

  deps.formatter.success("TOTP secret generated");
  deps.formatter.info("");
  deps.formatter.info("Scan this QR code with your authenticator app:");
  deps.formatter.info("");

  const qr = await qrcode.toString(otpauthUrl, { type: "terminal", small: true });
  deps.formatter.info(qr);

  deps.formatter.info(`Or manually enter: ${otpauthUrl}`);
  deps.formatter.info("");
  deps.formatter.info("Add to your .env file:");
  deps.formatter.info(`MECHA_OTP=${base32}`);
}

/** Execute the TOTP verify flow. */
export async function executeTotpVerify(code: string, deps: CommandDeps): Promise<void> {
  const secret = process.env.MECHA_OTP;
  if (!secret) {
    deps.formatter.error("MECHA_OTP not set. Run 'mecha dashboard totp setup' first.");
    process.exitCode = 1;
    return;
  }

  const { TOTP, Secret } = await import("otpauth");

  const totp = new TOTP({
    issuer: "mecha",
    label: "dashboard",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta !== null) {
    deps.formatter.success("Valid ✓");
  } else {
    deps.formatter.error("Invalid ✗");
    process.exitCode = 1;
  }
}

/* v8 ignore start -- commander wiring tested via execute* functions */
/** Register the 'dashboard totp' subcommand. */
export function registerDashboardTotpCommand(parent: Command, deps: CommandDeps): void {
  const totp = parent
    .command("totp")
    .description("Manage TOTP authentication");

  totp
    .command("setup")
    .description("Generate a new TOTP secret")
    .action(async () => withErrorHandler(deps, () => executeTotpSetup(deps)));

  totp
    .command("verify")
    .description("Verify a TOTP code")
    .argument("<code>", "6-digit TOTP code")
    .action(async (code: string) => withErrorHandler(deps, () => executeTotpVerify(code, deps)));
}
/* v8 ignore stop */
