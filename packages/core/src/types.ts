/** bot name: lowercase alphanumeric + hyphens, 1-32 chars */
export type BotName = string & { readonly __brand: "BotName" };

/** Node name: same rules as BotName */
export type NodeName = string & { readonly __brand: "NodeName" };

/** A resolved bot address */
export interface BotAddress {
  readonly bot: BotName;
  readonly node: NodeName;
}

/** A group address (Phase 2+) */
export interface GroupAddress {
  readonly group: string;
  readonly members: BotAddress[];
}

/** Union of all address types */
export type Address = BotAddress | GroupAddress;

/** Type guard for BotAddress */
export function isBotAddress(addr: Address): addr is BotAddress {
  return "bot" in addr && "node" in addr;
}

/** Type guard for GroupAddress */
export function isGroupAddress(addr: Address): addr is GroupAddress {
  return "group" in addr;
}
