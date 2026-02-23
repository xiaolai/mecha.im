import type { MechaRef } from "./types.js";

/** Serialize a MechaRef to a single string key: "node/id" or just "id" for local. */
export function mechaRefKey(ref: MechaRef): string {
  return ref.node === "local" ? ref.id : `${ref.node}/${ref.id}`;
}

/** Parse a MechaRef key back. Bare "mx-foo-abc" → { node: "local", id }. */
export function parseMechaRefKey(key: string): MechaRef {
  const slash = key.indexOf("/");
  if (slash === -1) return { node: "local", id: key };
  return { node: key.slice(0, slash), id: key.slice(slash + 1) };
}
