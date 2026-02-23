import { readNodesAsync } from "@mecha/agent";
import type { NodeEntry } from "@mecha/agent";

export interface MechaInfo {
  id: string;
  name: string;
  state: string;
  status: string;
  path: string;
  port?: number;
  created: number;
}

export interface MechaWithNode extends MechaInfo {
  node: string;
}

export async function agentFetch(
  entry: NodeEntry,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = entry.host.includes("://") ? entry.host : `http://${entry.host}`;
  const url = `${base}${path}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${entry.key}`);
  try {
    return await fetch(url, { ...init, headers, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function aggregateMechas(localMechas: MechaInfo[]): Promise<MechaWithNode[]> {
  const result: MechaWithNode[] = localMechas.map((m) => ({ ...m, node: "local" }));

  const nodes = await readNodesAsync();
  const remoteResults = await Promise.allSettled(
    nodes.map(async (entry) => {
      const res = await agentFetch(entry, "/mechas");
      if (!res.ok) return [];
      const mechas = (await res.json()) as MechaInfo[];
      return mechas.map((m) => ({ ...m, node: entry.name }));
    }),
  );

  for (const r of remoteResults) {
    if (r.status === "fulfilled") {
      result.push(...r.value);
    }
  }

  return result;
}
