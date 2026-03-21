import { KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import { createElement } from "react";

/** Map raw profile names to human-friendly labels. */
export function humanizeProfileName(name: string): string {
  if (name === "$env:api-key") return "API Key (env)";
  if (name === "$env:oauth") return "OAuth (env)";
  if (name.startsWith("$env:")) return name.slice(5) + " (env)";
  return name;
}

/** Check if an auth profile is expired. */
export function isExpired(expiresAt: number | null | undefined): boolean {
  if (expiresAt == null) return false;
  return expiresAt < Date.now();
}

/** Return a small icon element for the auth type, or null for unknown types. */
export function authTypeIcon(type: "oauth" | "api-key" | string | undefined) {
  if (type === "oauth") return createElement(ShieldCheckIcon, { className: "size-3 text-muted-foreground" });
  if (type === "api-key") return createElement(KeyRoundIcon, { className: "size-3 text-muted-foreground" });
  return null;
}
