---
globs:
  - "packages/dashboard/**/*.tsx"
  - "packages/dashboard/**/*.ts"
  - "packages/dashboard/**/*.css"
  - "packages/ui/**/*.tsx"
---

# Design System Reference

Authoritative reference for the dashboard tech stack, tokens, scales, and component patterns.

## Stack

- **Framework:** Next.js 15 App Router + React 19
- **Styling:** Tailwind CSS v4 (CSS-only config, NO tailwind.config.ts)
- **Components:** shadcn/ui (Radix primitives + CVA variants)
- **Icons:** lucide-react v0.575.0 (sole icon source)
- **Chat UI:** @assistant-ui/react v0.12
- **Dark mode:** next-themes with `.dark` class (`@custom-variant dark (&:is(.dark *))`)
- **Utility:** `cn()` from `@/lib/utils` (clsx + tailwind-merge)

## Color Tokens (OKLCH)

All colors come from CSS custom properties defined in `globals.css`. Use via Tailwind:

```
bg-background, text-foreground              — page bg/text
bg-card, text-card-foreground               — card surfaces
bg-primary, text-primary-foreground         — blue brand actions
bg-secondary, text-secondary-foreground     — gray secondary
bg-muted, text-muted-foreground             — subdued backgrounds/text
bg-accent, text-accent-foreground           — interactive hover states
bg-destructive, text-destructive-foreground — red/danger actions
border-border, border-input                 — borders
ring-ring                                   — focus rings
bg-success, text-success, text-success-foreground — green status
bg-warning, text-warning, text-warning-foreground — yellow status
bg-sidebar, text-sidebar-foreground         — sidebar-specific tokens
bg-sidebar-accent, bg-sidebar-primary       — sidebar states
```

For opacity variants: `bg-destructive/10`, `text-primary/80`, `bg-muted/50`

## Typography

System font stack (no imports needed):
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

Size scale: `text-xs` (12) → `text-sm` (14, default body) → `text-base` (16) → `text-lg` (18) → `text-xl` (20) → `text-2xl` (24)

Weights: `font-normal` (400) → `font-medium` (500, labels) → `font-semibold` (600, headings) → `font-bold` (700)

Use `font-mono` for: container IDs, ports, paths, API keys, session IDs, log output, code snippets.

## Spacing

Base unit: 4px. Use Tailwind spacing scale only (multiples of 4px).

Common patterns:
- Flex rows: `flex items-center gap-2`
- Form sections: `flex flex-col gap-3`
- Cards: `p-4` or `px-4 py-3`
- Page content: `p-5` or `px-6 py-4`

## Border Radius

```
rounded-sm   — 6px   (calc(var(--radius) - 4px))
rounded-md   — 8px   (calc(var(--radius) - 2px))  ← most common
rounded-lg   — 10px  (var(--radius))
rounded-xl   — 14px  (calc(var(--radius) + 4px))
rounded-2xl  — 16px  (chat bubbles)
rounded-full — circles/pills
```

## Icons

Import from `lucide-react` only. Sizes: `size-3` (compact), `size-4` (default 16px), `size-5` (prominent).

```tsx
import { CopyIcon, TrashIcon } from "lucide-react";
<CopyIcon className="size-4 text-muted-foreground" />
```

## Component Patterns

### Buttons (with text)
```tsx
<Button variant="default" size="sm">Primary</Button>
<Button variant="outline" size="xs" className="border-success text-success">Start</Button>
<Button variant="destructive" size="sm">Remove</Button>
```
Variants: default, destructive, outline, secondary, ghost, link
Sizes: default (h-9), xs (h-6), sm (h-8), lg (h-10)

### Icon Buttons (no text, tooltip required)
```tsx
<TooltipIconButton tooltip="Copy" variant="ghost" size="icon-sm">
  <CopyIcon />
</TooltipIconButton>
```
Icon sizes: icon-xs (24px), icon-sm (32px), icon (36px), icon-lg (40px)

### Status Indicators
```tsx
// Status dot
<span className={`size-2 rounded-full ${state === "running" ? "bg-success" : "bg-destructive"}`} />

// Badge
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success">
  running
</span>
```

### Cards
```tsx
<div className="rounded-lg border border-border bg-card p-4">
  <div className="text-xs font-medium text-muted-foreground mb-2">LABEL</div>
  <div className="text-sm font-semibold text-card-foreground">Value</div>
</div>
```

## Figma-to-Code Mapping

| Figma Property | Tailwind Class |
|---|---|
| Fill: near-white (#fafafa) | `bg-background` |
| Fill: dark (#161616) | `bg-background` (dark mode) |
| Fill: card gray (#f5f5f5 / #2a2a2a) | `bg-card` |
| Fill: blue (#4f46e5) | `bg-primary` |
| Fill: red (#ef4444) | `bg-destructive` |
| Fill: green (#4ade80) | `text-success` / `bg-success` |
| Border: gray | `border-border` |
| Text: primary | `text-foreground` |
| Text: secondary gray | `text-muted-foreground` |
| Font: system | (default, no class needed) |
| Font: monospace | `font-mono` |
| Shadow: sm/md/lg | `shadow-sm` / `shadow-md` / `shadow-lg` |

## Dropdown Menus

All dropdown menus (context menus, action menus, selects) MUST follow this pattern.

### Container
```tsx
className="bg-popover text-popover-foreground border border-border rounded-md p-1 shadow-md z-50 min-w-[8rem] overflow-x-hidden overflow-y-auto"
```

### Menu Item
```tsx
className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default focus:bg-accent focus:text-accent-foreground"
```

### Destructive Item
```tsx
className="... text-destructive focus:bg-destructive/10"
```

### Icons inside Items
```tsx
<SomeIcon className="size-4 text-muted-foreground" />
```

### Quick Reference

| Element | Classes |
|---|---|
| Menu container | `bg-popover text-popover-foreground border border-border rounded-md p-1 shadow-md` |
| Menu item | `flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default` |
| Item hover/focus | `focus:bg-accent focus:text-accent-foreground` |
| Destructive item | `text-destructive focus:bg-destructive/10` |
| Item icon | `size-4 text-muted-foreground` |
| Disabled item | `opacity-50 pointer-events-none` |

## File Organization

```
src/components/ui/          — shadcn primitives (auto-generated, rarely edit)
src/components/assistant-ui/ — chat thread, composer, attachments, tool fallback
src/components/sidebar/      — sidebar navigation components
src/components/layout/       — topbar, tab nav
src/components/             — feature components (MechaChat, LogViewer, etc.)
src/app/(dashboard)/        — authenticated dashboard routes
src/app/api/                — API routes (DO NOT modify for UI changes)
src/lib/                    — utilities, store, auth, docker client
```
