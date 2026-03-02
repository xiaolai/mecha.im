import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";

const TOTP_SECRET_FILE = "totp-secret";

/** Read TOTP secret from file, falling back to MECHA_OTP env var on ENOENT only. */
export function readTotpSecret(mechaDir: string): string | null {
  const filePath = join(mechaDir, TOTP_SECRET_FILE);
  try {
    const content = readFileSync(filePath, "utf-8").trim();
    if (content) return content;
  } catch (err: unknown) {
    // Only fall back to env on file-not-found; propagate other I/O errors
    /* v8 ignore start -- non-ENOENT I/O errors are filesystem-dependent */
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    /* v8 ignore stop */
  }
  return process.env.MECHA_OTP?.trim() || null;
}

/** Write TOTP secret to file with mode 0o600 using atomic temp+rename. */
export function writeTotpSecret(mechaDir: string, secret: string): void {
  if (!existsSync(mechaDir)) {
    mkdirSync(mechaDir, { recursive: true });
  }
  const filePath = join(mechaDir, TOTP_SECRET_FILE);
  const tmpPath = join(dirname(filePath), `.totp-secret.${process.pid}.tmp`);
  writeFileSync(tmpPath, secret + "\n", { mode: 0o600 });
  renameSync(tmpPath, filePath);
  // Ensure 0o600 on the final path (rename preserves source perms, but be explicit)
  chmodSync(filePath, 0o600);
}

/** Generate a new TOTP secret (base32). Requires otpauth at runtime. */
export async function generateTotpSecret(): Promise<string> {
  const { Secret } = await import("otpauth");
  return new Secret({ size: 20 }).base32;
}

/** Read existing TOTP secret or generate + store a new one. */
export async function ensureTotpSecret(mechaDir: string): Promise<{ secret: string; isNew: boolean }> {
  const existing = readTotpSecret(mechaDir);
  if (existing) return { secret: existing, isNew: false };
  const secret = await generateTotpSecret();
  writeTotpSecret(mechaDir, secret);
  return { secret, isNew: true };
}
