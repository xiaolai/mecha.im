import type { BotName, NodeName, BotAddress, Address } from "./types.js";
import { isValidName } from "./validation.js";
import { InvalidNameError, InvalidAddressError, GroupAddressNotSupportedError } from "./errors.js";

/** The default node name for unqualified addresses */
const LOCAL_NODE = "local" as NodeName;

/**
 * Validate and brand a string as a BotName.
 * @throws Error if the input is not a valid name
 */
export function botName(input: string): BotName {
  if (!isValidName(input)) {
    throw new InvalidNameError(input);
  }
  return input as BotName;
}

/**
 * Validate and brand a string as a NodeName.
 * @throws Error if the input is not a valid name
 */
export function nodeName(input: string): NodeName {
  if (!isValidName(input)) {
    throw new InvalidNameError(input);
  }
  return input as NodeName;
}

/**
 * Parse an address string into a structured Address.
 *
 * - "researcher"       → { bot: "researcher", node: "local" }
 * - "researcher@alice" → { bot: "researcher", node: "alice" }
 * - "+group"           → throws (groups not supported until Phase 2)
 *
 * @throws Error on invalid input
 */
export function parseAddress(input: string): Address {
  if (!input) {
    throw new InvalidAddressError("");
  }

  if (input.startsWith("+")) {
    throw new GroupAddressNotSupportedError(input);
  }

  const atCount = (input.match(/@/g) ?? []).length;
  if (atCount > 1) {
    throw new InvalidAddressError(input);
  }

  if (atCount === 1) {
    const [botPart, nodePart] = input.split("@") as [string, string];
    return {
      bot: botName(botPart),
      node: nodeName(nodePart),
    };
  }

  return {
    bot: botName(input),
    node: LOCAL_NODE,
  };
}

/**
 * Format a BotAddress back to a string.
 * Returns "researcher@alice" or "researcher" if node is "local".
 */
export function formatAddress(addr: BotAddress): string {
  if (addr.node === LOCAL_NODE) {
    return addr.bot;
  }
  return `${addr.bot}@${addr.node}`;
}
