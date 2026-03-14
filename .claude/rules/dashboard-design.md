---
description: Design system rules for agent/dashboard — component library, color tokens, layout conventions
globs:
  - "agent/dashboard/**/*.tsx"
  - "agent/dashboard/**/*.css"
---

# Dashboard Design System

UI components live in `agent/dashboard/src/components/`. Always use them — never write inline Tailwind for patterns they cover.

## Components (`import from "../components"`)

### Button

```tsx
<Button variant="primary" size="sm">Label</Button>
```

| Variant | Use |
|---------|-----|
| `primary` (default) | Main actions, form submits |
| `secondary` | Cancel, back, refresh |
| `destructive` | Dangerous confirms in dialogs |
| `destructive-soft` | Soft danger (e.g. "Stop Bot") |
| `ghost` | Inline row actions (Edit, Pause, Trigger) |
| `ghost-destructive` | Inline delete/remove |

| Size | Use |
|------|-----|
| `xs` | Inline row actions, compact buttons |
| `sm` (default) | Standard form buttons |
| `lg` | Dialog buttons, prominent actions |

### Input / Select / Textarea

```tsx
<Input mono className="w-full" />           // mono for cron, IDs
<Select compact>{options}</Select>           // compact for filters
<Textarea mono rows={6} className="w-full" /> // mono for code/prompts
```

Add `className="w-full"` or `className="flex-1"` for width — not built-in.

### Card

```tsx
<Card spacing={3}>content</Card>           // standard card, space-y-3
<Card compact>list item</Card>             // p-3 instead of p-4
<Card className="text-center">stat</Card>  // extra classes
```

### Alert

```tsx
<Alert variant="success">Done!</Alert>
<Alert variant="error" onDismiss={() => setError(null)}>Failed</Alert>
```

Common pattern:

```tsx
{message && <Alert variant={message.type}>{message.text}</Alert>}
```

### Dialog + DialogFooter

```tsx
<Dialog open={!!confirm} size="sm" title="Delete?" description="This cannot be undone.">
  <DialogFooter>
    <Button variant="secondary" size="lg" onClick={cancel}>Cancel</Button>
    <Button variant="destructive" size="lg" onClick={confirm}>Delete</Button>
  </DialogFooter>
</Dialog>
```

### StatusDot

```tsx
<StatusDot color="green" />                    // running
<StatusDot color="yellow" size="lg" />         // busy
<StatusDot color="success" pulse />            // active session
<StatusDot color="muted-lighter" />            // not configured
```

Colors: `green`, `yellow`, `red`, `blue`, `muted`, `muted-light`, `muted-lighter`, `success`
Sizes: `sm` (1.5), `md` (2, default), `lg` (2.5)

### Badge / StatusBadge

```tsx
<Badge variant="primary" onRemove={handleRemove}>{tag}</Badge>  // removable pill
<StatusBadge variant="success">active</StatusBadge>              // compact status
```

Variants: `success`, `warning`, `error`, `primary`, `blue`, `muted`

## Color Tokens

Use semantic tokens from `index.css` / `tailwind.config.js`. Never use raw Tailwind colors (e.g. `bg-gray-100`) except for status indicators via `/10` opacity.

| Token | Purpose |
|-------|---------|
| `bg-background` / `text-foreground` | Page background and default text |
| `bg-card` / `text-card-foreground` | Card surfaces |
| `bg-primary` / `text-primary-foreground` | Primary buttons and accents |
| `bg-secondary` / `text-secondary-foreground` | Secondary buttons |
| `bg-destructive` / `text-destructive-foreground` | Dangerous actions |
| `text-muted-foreground` | Labels, hints, secondary text |
| `border-border` | All borders |
| `bg-sidebar` / `text-sidebar-foreground` | Sidebar only |
| `bg-accent` | Hover/selected list items |

## Page Layout

Every top-level view:

```tsx
<div className="p-6 space-y-{4-6} max-w-4xl mx-auto h-full overflow-y-auto">
```

## Section Headings

```tsx
<h2 className="text-lg font-semibold text-foreground mb-3">Title</h2>
```

With action button:

```tsx
<div className="flex items-center justify-between mb-3">
  <h2 className="text-lg font-semibold text-foreground">Title</h2>
  <Button>+ Action</Button>
</div>
```

Sub-heading inside card: `<h3 className="text-sm font-medium text-foreground">`

## Labels

- Form field: `text-sm text-muted-foreground`
- Above input: `text-xs text-muted-foreground block mb-1`

## Typography

| Use | Classes |
|-----|---------|
| Body text | `text-sm text-foreground` |
| Secondary text | `text-sm text-muted-foreground` |
| Metadata / stats | `text-xs text-muted-foreground` |
| Monospace values | `text-sm text-foreground font-mono` |
| Code inline | `font-mono text-xs bg-muted px-1 py-0.5 rounded` |
| Section title | `text-lg font-semibold text-foreground` |
| Card subtitle | `text-sm font-medium text-foreground` |

## Empty & Loading States

```tsx
<p className="text-muted-foreground text-sm">No items yet</p>

<Card className="text-sm text-muted-foreground">Loading...</Card>
```

## Event Log Rows

```tsx
<div className="flex gap-3 py-1 border-b border-border/50">
  <span className="text-muted-foreground shrink-0">{time}</span>
  <span className="text-primary shrink-0">{type}</span>
  <span className="text-foreground truncate">{details}</span>
</div>
```

Container: `space-y-1 font-mono text-sm max-h-96 overflow-y-auto scrollbar-thin`

## Sidebar Navigation

```
w-10 h-10 rounded-lg flex items-center justify-center transition-colors
```

Active: `bg-sidebar-accent text-sidebar-accent-foreground`
Inactive: `text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent`

## Dark Mode

Handled via CSS custom properties — `.dark` swaps token values. Never use `dark:` for base colors. Only `dark:` usage: status text colors (e.g. `dark:text-green-400`) inside component internals.

## Anti-Patterns

- Never write inline Tailwind for buttons, cards, alerts, dialogs, inputs, badges, or status dots — use the components
- Never use raw Tailwind colors (`bg-slate-100`) — use semantic tokens
- Never use `shadow-*` on cards — only on dialogs
- Never use `transition` — always `transition-colors`
- Disabled state: `disabled:opacity-50`, optionally `disabled:cursor-not-allowed`
- Card dividers: `<div className="pt-2 border-t border-border">` (not `<hr>`)
