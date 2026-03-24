/** Detect cycles in the step dependency graph. Throws if a cycle is found. */
export function assertNoCycles(steps: Record<string, { depends?: string[] }>): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Cycle detected in workflow dependencies involving "${name}"`);
    visiting.add(name);
    const deps = steps[name]?.depends ?? [];
    for (const dep of deps) {
      const depName = dep.endsWith("?") ? dep.slice(0, -1) : dep;
      if (!steps[depName]) throw new Error(`Step "${name}" depends on unknown step "${depName}"`);
      visit(depName);
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of Object.keys(steps)) visit(name);
}
