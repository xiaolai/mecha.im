/** Vector clock: serverId → monotonic version counter. */
export type VectorClock = Record<string, number>;

/** Increment this server's entry in the clock. Returns a new object. */
export function increment(clock: VectorClock, serverId: string): VectorClock {
  return { ...clock, [serverId]: (clock[serverId] ?? 0) + 1 };
}

/** Merge two vector clocks, taking the max of each key. Returns a new object. */
export function merge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [key, val] of Object.entries(b)) {
    result[key] = Math.max(result[key] ?? 0, val);
  }
  return result;
}

/** True if `a` dominates `b`: a[k] >= b[k] for all keys and strictly > for at least one. */
export function isNewer(a: VectorClock, b: VectorClock): boolean {
  let strictlyGreater = false;
  // Check all keys in both clocks
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    /* v8 ignore start -- ?? 0 fallback: key always exists in at least one clock */
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;
    /* v8 ignore stop */
    if (aVal < bVal) return false; // a is behind on this key
    if (aVal > bVal) strictlyGreater = true;
  }
  return strictlyGreater;
}

/** Return server IDs where `local` is strictly ahead of `remote`. */
export function diff(local: VectorClock, remote: VectorClock): string[] {
  const ahead: string[] = [];
  for (const [key, val] of Object.entries(local)) {
    if (val > (remote[key] ?? 0)) ahead.push(key);
  }
  return ahead;
}
