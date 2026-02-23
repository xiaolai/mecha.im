/** CASA name: lowercase alphanumeric + hyphens, 1-32 chars */
export type CasaName = string & { readonly __brand: "CasaName" };

/** Node name: same rules as CasaName */
export type NodeName = string & { readonly __brand: "NodeName" };

/** A resolved CASA address */
export interface CasaAddress {
  readonly casa: CasaName;
  readonly node: NodeName;
}

/** A group address (Phase 2+) */
export interface GroupAddress {
  readonly group: string;
  readonly members: CasaAddress[];
}

/** Union of all address types */
export type Address = CasaAddress | GroupAddress;

/** Type guard for CasaAddress */
export function isCasaAddress(addr: Address): addr is CasaAddress {
  return "casa" in addr && "node" in addr;
}

/** Type guard for GroupAddress */
export function isGroupAddress(addr: Address): addr is GroupAddress {
  return "group" in addr;
}
