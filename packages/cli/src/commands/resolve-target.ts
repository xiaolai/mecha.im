import type { DockerClient } from "../types.js";
import { readNodes } from "@mecha/agent";
import type { NodeEntry } from "@mecha/agent";
import { MechaLocator } from "@mecha/service";
import type { RemoteTarget } from "@mecha/service";

/**
 * Resolve a mecha target from CLI args.
 * If --node "local" is given, return local target directly.
 * If --node is given (non-local), look up the node entry from the registry.
 * If --node is omitted, use MechaLocator to auto-detect.
 */
export async function resolveTarget(
  client: DockerClient,
  mechaId: string,
  nodeFlag: string | undefined,
): Promise<RemoteTarget> {
  if (nodeFlag === "local") {
    return { node: "local" };
  }

  const nodes = readNodes();

  if (nodeFlag) {
    const entry = nodes.find((n: NodeEntry) => n.name === nodeFlag);
    if (!entry) {
      throw new Error(`Node "${nodeFlag}" not found in node registry`);
    }
    return { node: nodeFlag, entry };
  }

  // Auto-detect using MechaLocator
  const locator = new MechaLocator();
  const ref = await locator.locate(client, mechaId, nodes);
  return { node: ref.node, entry: ref.entry };
}
