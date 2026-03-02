import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readTotpSecret, writeTotpSecret, generateTotpSecret } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";
import { displayTotpSetup } from "../totp-display.js";

export async function executeTotpSetup(deps: CommandDeps, force = false): Promise<void> {
  const existing = readTotpSecret(deps.mechaDir);
  if (existing && !force) {
    deps.formatter.warn("TOTP secret already exists. Use --force to overwrite.");
    return;
  }
  const secret = await generateTotpSecret();
  writeTotpSecret(deps.mechaDir, secret);
  await displayTotpSetup(secret, deps.formatter);
}

export async function executeTotpVerify(code: string, deps: CommandDeps): Promise<void> {
  const secret = readTotpSecret(deps.mechaDir);
  if (!secret) {
    deps.formatter.error("No TOTP secret configured. Run 'mecha totp setup' first.");
    process.exitCode = 1;
    return;
  }

  const { TOTP, Secret } = await import("otpauth");
  const totp = new TOTP({
    issuer: "mecha",
    label: "agent",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta !== null) {
    deps.formatter.success("Valid");
  } else {
    deps.formatter.error("Invalid");
    process.exitCode = 1;
  }
}

export function executeTotpStatus(deps: CommandDeps): void {
  const secret = readTotpSecret(deps.mechaDir);
  if (secret) {
    deps.formatter.success("TOTP is configured");
  } else {
    deps.formatter.info("TOTP is not configured. Run 'mecha totp setup' to generate a secret.");
  }
}

/* v8 ignore start -- commander wiring tested via execute* functions */
export function registerTotpCommand(program: Command, deps: CommandDeps): void {
  const totp = program
    .command("totp")
    .description("Manage TOTP authentication");

  totp
    .command("setup")
    .description("Generate a new TOTP secret")
    .option("--force", "Overwrite existing secret")
    .action(async (opts: { force?: boolean }) => withErrorHandler(deps, () => executeTotpSetup(deps, opts.force)));

  totp
    .command("verify")
    .description("Verify a TOTP code")
    .argument("<code>", "6-digit TOTP code")
    .action(async (code: string) => withErrorHandler(deps, () => executeTotpVerify(code, deps)));

  totp
    .command("status")
    .description("Show TOTP configuration status")
    .action(async () => withErrorHandler(deps, async () => executeTotpStatus(deps)));
}
/* v8 ignore stop */
