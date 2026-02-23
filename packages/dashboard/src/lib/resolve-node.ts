/**
 * Resolve a remote node target from the ?node= query parameter.
 * Returns a RemoteTarget for use with service remote-session functions.
 */

import type { NextRequest } from "next/server";
import { readNodes } from "@mecha/agent";
import { NodeUnreachableError } from "@mecha/contracts";
import type { RemoteTarget, ServiceNodeEntry } from "@mecha/service";

/**
 * Extract the node target from a request's ?node= query parameter.
 * If no ?node param or node is "local", returns a local target.
 * If node is specified, looks up the entry from nodes.json.
 * Throws if the named node is not registered.
 */
export function resolveNodeTarget(request: NextRequest): RemoteTarget {
  const nodeName = request.nextUrl.searchParams.get("node");

  if (!nodeName || nodeName === "local") {
    return { node: "local" };
  }

  const nodes = readNodes();
  const entry = nodes.find((n: ServiceNodeEntry) => n.name === nodeName);
  if (!entry) {
    throw new NodeUnreachableError(nodeName);
  }

  return { node: nodeName, entry: entry as ServiceNodeEntry };
}
