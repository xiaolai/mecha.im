export const MARKDOWN_SHOWCASE_USER_TEXT = `# Help me understand this architecture

I've been reading the docs and I have a few questions:

## Data Flow

How does data flow through these layers?

1. **API Gateway** — handles auth, rate limiting
2. **Service Layer** — business logic
3. **Repository** — data access

## Code Example

Here's what I have so far:

\`\`\`typescript
interface DataFlow {
  gateway: ApiGateway;
  service: ServiceLayer;
  repo: Repository<Entity>;
}

async function processRequest(req: Request): Promise<Response> {
  const validated = await gateway.validate(req);
  const result = await service.handle(validated);
  return repo.persist(result);
}
\`\`\`

## Questions

| Layer | Question |
|-------|----------|
| Gateway | Should auth be middleware or explicit? |
| Service | How to handle cross-cutting concerns? |
| Repo | Should we use Unit of Work pattern? |

> Note: I'm coming from a Django background where this is handled by the ORM automatically.

Also, what about \`error handling\`? Should each layer catch and re-throw, or let errors bubble up?

---

Thanks in advance!`;

export const MARKDOWN_SHOWCASE_ASSISTANT_TEXT = `Great questions! Let me break this down layer by layer.

## Data Flow Architecture

The flow you described is solid. Here's how I'd refine it:

\`\`\`
Request → Gateway (auth + validate) → Service (transform + rules) → Repo (persist) → Response
                                         ↓
                                    Event Bus (side effects)
\`\`\`

### 1. API Gateway

**Use middleware for auth** — it's cleaner and composable:

\`\`\`typescript
// middleware approach (recommended)
app.use("/api/*", authMiddleware);
app.use("/api/*", rateLimitMiddleware);

// vs explicit (avoid)
async function handler(req: Request) {
  await checkAuth(req);     // easy to forget
  await checkRateLimit(req); // ordering matters
  // ...actual logic
}
\`\`\`

### 2. Service Layer

For cross-cutting concerns, use the **decorator pattern**:

\`\`\`typescript
class OrderService {
  @Transactional()
  @AuditLog("order.create")
  @CacheInvalidate("orders")
  async createOrder(dto: CreateOrderDto): Promise<Order> {
    // pure business logic — no infrastructure concerns
    const order = Order.create(dto);
    await this.repo.save(order);
    this.events.emit("order.created", order);
    return order;
  }
}
\`\`\`

### 3. Repository Pattern

Given your Django background, here's the comparison:

| Django ORM | TypeScript Repo |
|-----------|----------------|
| \`Model.objects.filter()\` | \`repo.findMany({ where })\` |
| \`model.save()\` | \`repo.save(entity)\` |
| \`Model.objects.select_related()\` | \`repo.findOne({ relations })\` |
| Automatic Unit of Work | Explicit \`@Transactional()\` |

> **Key difference**: Django's ORM tracks changes automatically. In TypeScript, you need explicit Unit of Work or just save what you changed.

### Error Handling

**Let errors bubble up** with typed exceptions at service boundaries:

\`\`\`typescript
// Service throws domain errors
class InsufficientFundsError extends DomainError {
  constructor(public balance: number, public required: number) {
    super(\`Need \${required} but only have \${balance}\`);
  }
}

// Gateway catches and maps to HTTP
app.onError((err, c) => {
  if (err instanceof DomainError) return c.json({ error: err.message }, 400);
  if (err instanceof NotFoundError) return c.json({ error: "Not found" }, 404);
  log.error("Unhandled", err);
  return c.json({ error: "Internal error" }, 500);
});
\`\`\`

This keeps each layer focused on its own concerns.`;

export const MARKDOWN_SHOWCASE_THINKING = `The user is asking about a layered architecture pattern. They mentioned Django background, so I should draw parallels.

Key points to cover:
1. Gateway auth: middleware vs explicit — middleware is better for composability
2. Cross-cutting concerns: decorator pattern is cleanest in TypeScript
3. Repository vs Django ORM: they'll want a comparison table
4. Error handling: domain errors bubble up, gateway maps to HTTP

I should use concrete code examples since they showed TypeScript code.`;

export const TESTING_ANSWER = `Each layer should be testable in isolation:

\`\`\`typescript
// Service test — mock the repo
describe("OrderService", () => {
  it("creates order with valid data", async () => {
    const repo = mock<OrderRepo>();
    const service = new OrderService(repo);

    const order = await service.createOrder({
      items: [{ sku: "ABC", qty: 2 }],
      customer: "cust_123",
    });

    expect(order.status).toBe("pending");
    expect(repo.save).toHaveBeenCalledWith(order);
  });
});
\`\`\`

**Testing pyramid**:
- Unit tests: service logic (fast, many)
- Integration tests: repo + real DB (slower, fewer)
- E2E tests: full request cycle (slowest, minimal)`;

export const HALTING_PROBLEM_ANSWER = `## The Halting Problem

The halting problem, proved undecidable by Turing in 1936, states that **no general algorithm can determine whether an arbitrary program will eventually halt or run forever**.

### The Proof (by contradiction)

Suppose a function \`halts(program, input)\` exists that returns \`true\` if \`program(input)\` halts:

\`\`\`python
def paradox():
    if halts(paradox, None):
        while True: pass  # loop forever
    else:
        return  # halt
\`\`\`

- If \`halts(paradox, None)\` returns \`true\` → \`paradox\` loops forever (contradiction)
- If \`halts(paradox, None)\` returns \`false\` → \`paradox\` halts (contradiction)

### Impact on Static Analysis

This means **all static analysis is necessarily approximate**:

| What we want | What's possible |
|-------------|----------------|
| "Will this code crash?" | Undecidable in general |
| "Is this variable always non-null?" | Must over-approximate |
| "Does this function always return?" | Undecidable |
| "Is this code reachable?" | Undecidable in general |

Tools like TypeScript's type checker, ESLint, and Rust's borrow checker use **sound over-approximation** — they may reject valid programs, but never accept invalid ones. That's why you sometimes fight the type checker even when you *know* the code is correct.

> "The first principle is that you must not fool yourself — and you are the easiest person to fool." — Feynman
>
> Static analysis tools embody this: better a false positive than a missed bug.`;

export const HALTING_PROBLEM_THINKING = `This is a fundamental CS theory question. Let me structure this clearly.

The halting problem proof by diagonalization:
1. Assume halts(P, I) exists
2. Construct paradox that uses halts on itself
3. Show both outcomes lead to contradiction
4. Therefore halts() cannot exist

For static analysis implications:
- Rice's theorem generalizes this: ANY non-trivial semantic property of programs is undecidable
- Static analysis must therefore choose between soundness (no false negatives, may have false positives) and completeness (no false positives, may have false negatives)
- Most production tools choose soundness — TypeScript, Rust borrow checker, Java's type system
- Some tools choose completeness for specific properties — like linters that only flag patterns they're certain about

I should include:
- The proof sketch (accessible but rigorous)
- A table showing what's decidable vs not
- Connection to real tools they've likely used
- A good quote to make it memorable`;

export const TOOL_USE_SERVER_CONTENT = `     1→import { Hono } from "hono";
     2→
     3→const app = new Hono();
     4→
     5→app.get("/health", (c) => {
     6→  return c.json({ status: "ok" });
     7→});
     8→
     9→app.post("/api/data", async (c) => {
    10→  const body = await c.req.json();
    11→  return c.json({ received: body });
    12→});
    13→
    14→export default app;`;

export const TOOL_USE_GREP_RESULT = `/app/src/server.ts:5:app.get("/health"
/app/src/middleware.ts:12:  if (path === "/health") return next();
/app/tests/server.test.ts:8:  const res = await app.request("/health");`;

export const TOOL_USE_GLOB_RESULT = `/app/tests/server.test.ts
/app/tests/middleware.test.ts
/app/tests/api.test.ts`;

export const TOOL_USE_TEST_RESULT = `PASS  tests/server.test.ts
PASS  tests/middleware.test.ts
FAIL  tests/api.test.ts
  ● POST /api/data › returns received body

    Expected: 200
    Received: 404

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 8 passed, 9 total
Coverage:    78.4% statements, 65.2% branches`;

export const SECURITY_REVIEW_USER_TEXT = `## Security Review Request

Please review \`/app/src/auth.ts\` for timing attacks.

### What to check:
- String comparison of secrets (should use constant-time)
- Token validation flow
- Any \`===\` on secret values

### Reference:
> Timing attacks exploit the fact that string comparison short-circuits on the first mismatched character, leaking information about the secret one byte at a time.

\`\`\`
Attack: measure response time for "a..." vs "b..." vs "c..." to guess first char
\`\`\``;

export const AUTH_FILE_CONTENT = `import { createHmac } from "node:crypto";

const SECRET = process.env.AUTH_SECRET!;

export function validateToken(token: string): boolean {
  const expected = createHmac("sha256", SECRET).update("auth").digest("hex");
  if (token === expected) {  // BUG: timing-vulnerable comparison
    return true;
  }
  return false;
}`;

export const TIMING_FIX_THINKING = `The user is right — line 7 uses === for comparing the token against the HMAC digest. This is a classic timing attack vulnerability.

The fix: use crypto.timingSafeEqual() which compares in constant time regardless of where the strings differ.

I need to:
1. Replace === with timingSafeEqual
2. Ensure both buffers are the same length (timingSafeEqual throws if they differ)
3. Run the tests`;

export const AUTH_TEST_RESULT = `PASS  tests/auth.test.ts
  validateToken
    ✓ accepts valid token (3ms)
    ✓ rejects invalid token (1ms)
    ✓ rejects empty token (0ms)

Tests: 3 passed, 3 total
Time:  0.45s`;

export const TIMING_FIX_SUMMARY = `Fixed the timing vulnerability:

**Before** (vulnerable):
\`\`\`typescript
if (token === expected)  // short-circuits on first mismatch
\`\`\`

**After** (safe):
\`\`\`typescript
if (timingSafeEqual(Buffer.from(token), Buffer.from(expected)))
\`\`\`

All 3 auth tests pass. The comparison now takes constant time regardless of input, preventing timing-based secret extraction.`;

export const LONG_CONVERSATION_TOPICS = [
  { q: "What's the difference between `Map` and `Object` in JavaScript?", a: "**`Map`** preserves insertion order, allows any key type, and has `.size`. **`Object`** only supports string/symbol keys and has prototype chain. Use `Map` for dynamic key-value stores, `Object` for structured data." },
  { q: "When should I use WeakMap?", a: "Use `WeakMap` when keys are objects and you want garbage collection to work — e.g., storing metadata about DOM nodes or caching computed values for objects without preventing their GC." },
  { q: "How does garbage collection work in V8?", a: "V8 uses **generational GC**:\n\n1. **Young generation** (Scavenger): small, fast, frequent. New objects start here.\n2. **Old generation** (Mark-Sweep-Compact): larger, slower, less frequent. Surviving objects promote here.\n\n```\nNew object → Young Gen → (survives 2 GCs) → Old Gen → (unreachable) → Collected\n```" },
  { q: "What about memory leaks in Node.js?", a: "Common Node.js memory leaks:\n\n- **Event listeners** not removed: `emitter.on()` without `off()`\n- **Closures** capturing large scopes\n- **Global caches** that grow unbounded\n- **Circular references** with C++ addons\n\nDebug with `--inspect` + Chrome DevTools heap snapshots." },
  { q: "Show me how to profile memory usage", a: "```typescript\n// Built-in\nconst used = process.memoryUsage();\nconsole.log({\n  heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,\n  heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,\n  rss: `${Math.round(used.rss / 1024 / 1024)}MB`,\n});\n\n// Heap snapshot\nconst v8 = require('v8');\nconst snap = v8.writeHeapSnapshot();\nconsole.log(`Heap snapshot: ${snap}`);\n```\n\nOr use `clinic.js` for production profiling:\n```bash\nnpx clinic doctor -- node server.js\n```" },
  { q: "What's the event loop order of execution?", a: "```\n┌───────────────────────────┐\n│         timers            │  ← setTimeout, setInterval\n├───────────────────────────┤\n│     pending callbacks     │  ← I/O callbacks deferred\n├───────────────────────────┤\n│       idle, prepare       │  ← internal only\n├───────────────────────────┤\n│          poll             │  ← I/O events, incoming data\n├───────────────────────────┤\n│         check             │  ← setImmediate\n├───────────────────────────┤\n│      close callbacks      │  ← socket.on('close')\n└───────────────────────────┘\n```\n\n**Microtasks** (`Promise.then`, `queueMicrotask`) run between each phase." },
];
