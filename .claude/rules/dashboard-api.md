---
description: API fetch patterns for dashboard components — error handling, state management, data fetching conventions
globs:
  - "agent/dashboard/src/**/*.tsx"
---

# Dashboard API Conventions

## Fetching Data

Use `botFetch` (per-bot routes) or `fleetFetch` (fleet routes) — never raw `fetch`.

### Initial Load

Always check `resp.ok` before parsing. Validate shape before setting state.

```tsx
useEffect(() => {
  botFetch("/api/thing")
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((data) => setState(data as ThingType))
    .catch(() => setError("Failed to load"));
}, []);
```

### Multiple Endpoints

If one is required and another is optional, fetch sequentially — don't let optional failure block required data:

```tsx
const loadData = async () => {
  try {
    const resp = await botFetch("/api/required");
    if (!resp.ok) throw new Error();
    setData(await resp.json());
  } catch { setError("Failed"); return; }
  try {
    const resp = await botFetch("/api/optional");
    if (resp.ok) setExtra(await resp.json());
  } catch { /* optional, ignore */ }
};
```

## Mutations

Pattern: set busy, clear message, try/catch, check resp.ok, show result.

```tsx
async function handleAction() {
  setBusy(true);
  setMessage(null);
  try {
    const resp = await botFetch("/api/thing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json() as Record<string, unknown>;
    if (!resp.ok) {
      setMessage({ text: String(data.error ?? "Failed"), type: "error" });
      return;
    }
    setMessage({ text: "Done", type: "success" });
    refresh();
  } catch {
    setMessage({ text: "Network error", type: "error" });
  } finally {
    setBusy(false);
  }
}
```

## Message State

Standard shape across all views:

```tsx
const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
```

## Polling

Use `useRef` for interval handles. Clean up in effect return.

```tsx
const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

useEffect(() => {
  refresh();
  pollRef.current = setInterval(refresh, 10_000);
  return () => clearInterval(pollRef.current);
}, [refresh]);
```

## Busy / Loading States

- `loading` boolean for initial data load — show loading placeholder
- `actionBusy` / `saving` / `formBusy` for mutations — disable buttons, show "..." text
- Buttons show loading text: `{busy ? "Saving..." : "Save"}`

## Busy Dialog (409 BOT_BUSY)

When a bot action returns 409 with `code: "BOT_BUSY"`, show a confirmation dialog offering force action:

```tsx
if (resp.status === 409 && data.code === "BOT_BUSY") {
  setBusyDialog({ action, state: String(data.state ?? "busy") });
}
```
