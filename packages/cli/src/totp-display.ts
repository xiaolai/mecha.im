import type { Formatter } from "./types.js";

/** Display TOTP setup info: QR code + manual secret. */
export async function displayTotpSetup(secret: string, formatter: Formatter): Promise<void> {
  const { TOTP, Secret } = await import("otpauth");
  const qrcode = await import("qrcode");

  const totp = new TOTP({
    issuer: "mecha",
    label: "agent",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });

  const otpauthUrl = totp.toString();

  /* v8 ignore start -- JSON output branch for machine-readable consumers */
  if (formatter.isJson) {
    formatter.json({ secret, otpauthUrl });
    return;
  }
  /* v8 ignore stop */

  formatter.success("TOTP secret generated and saved");
  formatter.info("");
  formatter.info("Scan this QR code with your authenticator app:");
  formatter.info("");

  const qr = await qrcode.toString(otpauthUrl, { type: "terminal", small: true });
  formatter.info(qr);

  formatter.info(`Or manually enter: ${otpauthUrl}`);
  formatter.info("");
}
