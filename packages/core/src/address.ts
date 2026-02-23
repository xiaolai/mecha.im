import type { CasaName, NodeName, CasaAddress, Address } from "./types.js";
import { isValidName, NAME_MAX_LENGTH } from "./validation.js";

/** The default node name for unqualified addresses */
const LOCAL_NODE = "local" as NodeName;

/**
 * Validate and brand a string as a CasaName.
 * @throws Error if the input is not a valid name
 */
export function casaName(input: string): CasaName {
  if (!isValidName(input)) {
    throw new Error(
      `Invalid CASA name: "${input}" (must be lowercase alphanumeric/hyphens, 1-${NAME_MAX_LENGTH} chars, no leading/trailing hyphen)`,
    );
  }
  return input as CasaName;
}

/**
 * Validate and brand a string as a NodeName.
 * @throws Error if the input is not a valid name
 */
export function nodeName(input: string): NodeName {
  if (!isValidName(input)) {
    throw new Error(
      `Invalid node name: "${input}" (must be lowercase alphanumeric/hyphens, 1-${NAME_MAX_LENGTH} chars, no leading/trailing hyphen)`,
    );
  }
  return input as NodeName;
}

/**
 * Parse an address string into a structured Address.
 *
 * - "researcher"       → { casa: "researcher", node: "local" }
 * - "researcher@alice" → { casa: "researcher", node: "alice" }
 * - "+group"           → throws (groups not supported until Phase 2)
 *
 * @throws Error on invalid input
 */
export function parseAddress(input: string): Address {
  if (!input) {
    throw new Error('Invalid address: "" (empty string)');
  }

  if (input.startsWith("+")) {
    throw new Error(
      `Group addresses are not supported yet: "${input}"`,
    );
  }

  const atCount = (input.match(/@/g) ?? []).length;
  if (atCount > 1) {
    throw new Error(
      `Invalid address: "${input}" (multiple @ signs)`,
    );
  }

  if (atCount === 1) {
    const [casaPart, nodePart] = input.split("@") as [string, string];
    return {
      casa: casaName(casaPart),
      node: nodeName(nodePart),
    };
  }

  return {
    casa: casaName(input),
    node: LOCAL_NODE,
  };
}

/**
 * Format a CasaAddress back to a string.
 * Returns "researcher@alice" or "researcher" if node is "local".
 */
export function formatAddress(addr: CasaAddress): string {
  if (addr.node === LOCAL_NODE) {
    return addr.casa;
  }
  return `${addr.casa}@${addr.node}`;
}
