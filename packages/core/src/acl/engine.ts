import type { AclRule, AclResult, Capability } from "./types.js";
import { loadAcl, saveAcl } from "./persistence.js";
import { readBotConfig } from "../bot-config.js";
import { isValidAddress } from "../validation.js";
import { InvalidAddressError } from "../errors.js";
import { join } from "node:path";

export interface AclEngine {
  /** Grant: source can use capabilities on target. */
  grant(source: string, target: string, caps: Capability[]): void;

  /** Revoke: remove specific capabilities from source→target. */
  revoke(source: string, target: string, caps: Capability[]): void;

  /** Check: can source use capability on target? Double-check against expose. */
  check(source: string, target: string, cap: Capability): AclResult;

  /** List all connect rules. */
  listRules(): AclRule[];

  /** List what a bot can connect to. */
  listConnections(source: string): { target: string; caps: Capability[] }[];

  /** Persist current state to disk. */
  save(): void;
}

export interface CreateAclEngineOpts {
  mechaDir: string;
  /** Override for reading expose config — used in tests. */
  getExpose?: (name: string) => Capability[];
}

/**
 * Create an ACL engine backed by mechaDir/acl.json.
 * The engine reads connect rules from acl.json and expose from each bot's config.json.
 */
export function createAclEngine(opts: CreateAclEngineOpts): AclEngine {
  const { mechaDir } = opts;
  // Re-read acl.json on read operations to pick up external changes (hot-reload).
  // Skip reload if there are unsaved in-memory mutations (from grant/revoke).
  let data = loadAcl(mechaDir);
  let dirty = false;
  function reload(): void {
    if (!dirty) data = loadAcl(mechaDir);
  }

  /* v8 ignore start -- default getExpose always overridden in tests */
  const getExpose = opts.getExpose ?? ((name: string): Capability[] => {
    // Extract bot name from address (strip @node suffix)
    const botPart = name.includes("@") ? name.slice(0, name.indexOf("@")) : name;
    const config = readBotConfig(join(mechaDir, botPart));
    return (config?.expose as Capability[]) ?? [];
  });
  /* v8 ignore stop */

  function findRule(source: string, target: string): AclRule | undefined {
    return data.rules.find((r) => r.source === source && r.target === target);
  }

  function validateNames(source: string, target: string): void {
    if (!isValidAddress(source)) throw new InvalidAddressError(source);
    if (!isValidAddress(target)) throw new InvalidAddressError(target);
  }

  const engine: AclEngine = {
    grant(source, target, caps) {
      validateNames(source, target);
      const existing = findRule(source, target);
      if (existing) {
        const set = new Set(existing.capabilities);
        for (const c of caps) set.add(c);
        existing.capabilities = [...set];
      } else {
        data.rules.push({ source, target, capabilities: [...caps] });
      }
      dirty = true;
    },

    revoke(source, target, caps) {
      validateNames(source, target);
      const existing = findRule(source, target);
      if (!existing) return;
      existing.capabilities = existing.capabilities.filter((c) => !caps.includes(c));
      if (existing.capabilities.length === 0) {
        data.rules = data.rules.filter((r) => r !== existing);
      }
      dirty = true;
    },

    check(source, target, cap) {
      validateNames(source, target);
      reload();
      // Check 1: connect rule exists
      const rule = findRule(source, target);
      if (!rule || !rule.capabilities.includes(cap)) {
        return { allowed: false, reason: "no_connect" };
      }

      // Check 2: target exposes this capability
      const exposed = getExpose(target);
      if (!exposed.includes(cap)) {
        return { allowed: false, reason: "not_exposed" };
      }

      return { allowed: true };
    },

    listRules() {
      reload();
      return data.rules.map((r) => ({ ...r, capabilities: [...r.capabilities] }));
    },

    listConnections(source) {
      reload();
      return data.rules
        .filter((r) => r.source === source)
        .map((r) => ({ target: r.target, caps: [...r.capabilities] }));
    },

    save() {
      saveAcl(mechaDir, data);
      dirty = false;
    },
  };

  return engine;
}
