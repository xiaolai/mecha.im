import { NextResponse } from "next/server";
import { getNode, isValidName, type NodeEntry } from "@mecha/core";
import { getMechaDir, log } from "@/lib/pm-singleton";
import { proxyToNode } from "@/lib/mesh-proxy";

/**
 * Parse `?node=X` from the request URL.
 * Returns undefined for local/missing, or NodeEntry for remote dispatch.
 * Returns NextResponse on validation errors (400/502).
 */
export async function resolveNodeParam(
  req: Request,
): Promise<{ node: undefined } | { node: NodeEntry } | { error: NextResponse }> {
  const url = new URL(req.url);
  const nodeParam = url.searchParams.get("node");

  if (!nodeParam || nodeParam === "local") {
    return { node: undefined };
  }

  if (!isValidName(nodeParam)) {
    return { error: NextResponse.json({ error: `Invalid node name: ${nodeParam}` }, { status: 400 }) };
  }

  const mechaDir = getMechaDir();
  const entry = getNode(mechaDir, nodeParam);
  if (!entry) {
    return { error: NextResponse.json({ error: `Node not found: ${nodeParam}` }, { status: 404 }) };
  }

  return { node: entry };
}

/**
 * Proxy a request to a remote node and return the response as NextResponse.
 */
export async function proxyRequest(
  node: NodeEntry,
  method: string,
  path: string,
  body?: unknown,
): Promise<NextResponse> {
  try {
    const res = await proxyToNode(node, method, path, body);
    const data = await res.json().catch(() => null);
    return NextResponse.json(data ?? { ok: true }, { status: res.status });
  } catch (err) {
    log.error("proxy", `Failed to proxy to ${node.name}`, err);
    return NextResponse.json(
      { error: `Node ${node.name} unreachable` },
      { status: 502 },
    );
  }
}
