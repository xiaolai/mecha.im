/**
 * Shared discovery filter logic.
 * Data fetching differs by caller (ProcessManager vs filesystem);
 * filtering logic is unified here.
 */

export interface DiscoverableEntry {
  tags: string[];
  expose: string[];
}

export interface DiscoveryFilter {
  tag?: string;
  tags?: string[];
  capability?: string;
}

/** Discovery index entry written to discovery.json */
export interface DiscoveryIndexEntry {
  name: string;
  tags: string[];
  expose: string[];
  state: string;
}

/** Discovery index persisted at mechaDir/discovery.json */
export interface DiscoveryIndex {
  version: 1;
  updatedAt: string;
  bots: DiscoveryIndexEntry[];
}

/**
 * Returns true if the entry matches all provided filter criteria.
 * - `tag`: entry must have this single tag
 * - `tags`: entry must have ALL of these tags
 * - `capability`: entry must expose this capability
 */
export function matchesDiscoveryFilter(entry: DiscoverableEntry, filter: DiscoveryFilter): boolean {
  if (filter.tag && !entry.tags.includes(filter.tag)) return false;
  if (filter.tags && filter.tags.length > 0) {
    const has = new Set(entry.tags);
    if (!filter.tags.every((t) => has.has(t))) return false;
  }
  if (filter.capability && !entry.expose.includes(filter.capability)) return false;
  return true;
}
