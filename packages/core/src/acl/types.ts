/** Capabilities that can be granted between bots. */
export type Capability =
  | "query"
  | "read_workspace"
  | "write_workspace"
  | "execute"
  | "read_sessions"
  | "lifecycle";

export const ALL_CAPABILITIES: readonly Capability[] = [
  "query",
  "read_workspace",
  "write_workspace",
  "execute",
  "read_sessions",
  "lifecycle",
] as const;

/** A connect rule: source can use capabilities on target. */
export interface AclRule {
  source: string;
  target: string;
  capabilities: Capability[];
}

/** Result of an ACL check. */
export type AclResult =
  | { allowed: true }
  | { allowed: false; reason: "no_connect" | "not_exposed" };

/** Validate that a string is a valid Capability. */
export function isCapability(s: string): s is Capability {
  return (ALL_CAPABILITIES as readonly string[]).includes(s);
}
