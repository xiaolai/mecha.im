---
description: Enforces behavior-driven test quality — bans wiring-only tests
globs: "**/__tests__/**/*.test.ts"
---

# Test Quality Rule

## The one rule: Test BEHAVIOR, not WIRING

Every test must verify what the code DOES (return values, side effects, state changes), not how it does it (which functions it called internally).

## Quick check

Before writing `expect(mockFn).toHaveBeenCalledWith(...)`, ask: "Do I also assert the observable result?" If no — your test is wiring-only and will pass even if the code is broken.

## Assertion requirements

Every `it()` block MUST include at least one of:
- `expect(result)...` — verify return value
- `expect(() => fn()).toThrow(...)` — verify error
- `expect(formatter.success).toHaveBeenCalledWith("...")` — verify user-facing output
- `expect(await db.query(...))...` — verify state change
- `expect(response.statusCode)...` — verify HTTP response
- `expect(streamOutput)...` — verify collected stream data

Mock call assertions (`toHaveBeenCalledWith`) are allowed ONLY as supplements alongside the above.

## Mock boundaries

**Acceptable to mock**: network I/O, child_process, Date.now, crypto.randomBytes

**Never mock**: Internal modules from this repo, Zod schemas, pure functions, type definitions

## Prefer real implementations

```typescript
// PREFER: Real Fastify injection
const res = await app.inject({ method: "GET", url: "/healthz" });
expect(res.statusCode).toBe(200);

// PREFER: Real temp directory
const dir = mkdtempSync(join(tmpdir(), "test-"));
writeFileSync(join(dir, ".env"), "KEY=value");
// ... test with real filesystem ...

// PREFER: Real in-memory SQLite
const db = new Database(":memory:");
runMigrations(db);
expect(db.prepare("SELECT ...").all()).toHaveLength(1);

// PREFER: Real Zod validation
expect(() => MechaUpInput.parse({ projectPath: "" })).toThrow();
```

## Security tests

Security properties (sandbox isolation, path traversal guards) MUST be verified via integration tests — NOT via mock call argument assertions.

## v8 ignore pragmas

Use `/* v8 ignore start */` / `/* v8 ignore stop */` for defensive branches that can't be reached in tests. **Never** use `/* v8 ignore next N */` — it fails silently on:

- `??` null coalescing fallback branches
- `? :` ternary alternate branches
- `catch` block bodies
- `&&` / `||` short-circuit branches

```typescript
// WRONG — v8 still counts branches inside "next" pragmas
/* v8 ignore next */
const x = value ?? fallback;
/* v8 ignore next 3 */
} catch {
  return undefined;
}

// RIGHT — start/stop reliably excludes everything between them
/* v8 ignore start -- reason */
const x = value ?? fallback;
/* v8 ignore stop */

/* v8 ignore start -- corrupt file fallback */
} catch {
  return undefined;
}
/* v8 ignore stop */
```

**Allowed uses** (always include a reason comment):
- Catch blocks for corrupt file / IO fallbacks
- Type guard functions only hit with valid data
- Default parameter lambdas overridden in tests
- Null coalescing fallbacks for optional fields
- Race condition guards (config vanishes between checks)

**Never ignore**: Business logic, security checks, error handling that should be tested.
