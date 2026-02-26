import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AclRule } from "./types.js";
import { isCapability } from "./types.js";
import { safeReadJson } from "../safe-read.js";

export interface AclData {
  version: number;
  rules: AclRule[];
}

function isAclRule(v: unknown): v is AclRule {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.source !== "string" || typeof o.target !== "string") return false;
  if (!Array.isArray(o.capabilities)) return false;
  return (o.capabilities as unknown[]).every((c) => typeof c === "string" && isCapability(c));
}

function isAclData(v: unknown): v is AclData {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.version !== "number") return false;
  if (!Array.isArray(o.rules)) return false;
  return (o.rules as unknown[]).every(isAclRule);
}

/** Load ACL rules from mechaDir/acl.json. Returns empty if missing. */
export function loadAcl(mechaDir: string): AclData {
  const aclPath = join(mechaDir, "acl.json");
  const result = safeReadJson<unknown>(aclPath, "ACL rules");
  if (!result.ok) {
    if (result.reason !== "missing") {
      console.error(`[mecha] ${result.detail}`);
    }
    return { version: 1, rules: [] };
  }
  if (!isAclData(result.data)) {
    console.error(`[mecha] ACL rules: schema validation failed`);
    return { version: 1, rules: [] };
  }
  return result.data;
}

/** Save ACL rules to mechaDir/acl.json (atomic write). */
export function saveAcl(mechaDir: string, data: AclData): void {
  const aclPath = join(mechaDir, "acl.json");
  const tmp = aclPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, aclPath);
}
