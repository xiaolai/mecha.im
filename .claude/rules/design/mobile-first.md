---
globs:
  - "packages/dashboard/**/*.tsx"
  - "packages/ui/**/*.tsx"
---

# Mobile-First Rules

Write base styles for mobile. Layer up with `sm:`, `md:`, `lg:` breakpoints. Never the reverse.

## Touch Targets

Minimum interactive size: 44x44px (`min-h-11 min-w-11`).

On desktop, the constraint can be relaxed — icon button sizes `icon-xs` (24px) and `icon-sm` (32px) are acceptable at `sm:` and above. On mobile, ensure tappable area meets 44px.

```tsx
// Mobile-safe icon button
<TooltipIconButton tooltip="Copy" size="icon" className="sm:size-8">
  <CopyIcon />
</TooltipIconButton>
```

Spacing between interactive elements: `gap-3` minimum to prevent mis-taps. `gap-2` is acceptable for non-interactive items (labels, text, badges).

## Layout

**NEVER** use fixed widths without a responsive fallback. Always start with `w-full`.

```tsx
// WRONG
className="w-96"

// RIGHT
className="w-full sm:w-96"
className="w-full max-w-sm"
```

Stack vertically on mobile, go horizontal at `md:`:

```tsx
className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4"
```

## Navigation

- Sidebar collapses to off-canvas drawer on mobile (toggle via `md:hidden` button)
- **NEVER** rely on hover as the only way to reveal controls — hover does not exist on touch

```tsx
// WRONG — invisible on mobile
className="opacity-0 group-hover:opacity-100"

// RIGHT — visible on mobile, hover-reveal on desktop
className="sm:opacity-0 sm:group-hover:opacity-100"
```

## Typography

Minimum body text: `text-sm` (14px). Reserve `text-xs` (12px) for labels, captions, and metadata only — never for readable content.

## Buttons

Full-width on mobile, auto-width on desktop:

```tsx
<Button className="w-full sm:w-auto">Save Changes</Button>
```

## Inputs & Forms

- Minimum input height: `h-11` (44px) on mobile, `sm:h-9` on desktop
- Use semantic `type` for mobile keyboards: `email`, `tel`, `url`, `number`, `search`
- Single-column forms on mobile; multi-column at `md:` only
- Labels above inputs, not inline

```tsx
<input type="email" className="h-11 sm:h-9 w-full" />
```

## Dialogs & Modals

Full-screen on mobile, constrained on desktop:

```tsx
<DialogContent className="max-h-dvh sm:max-w-lg">
```

Use `dvh` instead of `vh` to account for mobile browser chrome.

## Content Overflow

**NEVER** allow horizontal scrolling on the page.

```tsx
className="truncate"           // single line
className="line-clamp-2"       // multi-line
className="min-w-0"            // on flex children
className="overflow-x-auto"    // only on data tables
```

## Viewport

- Use `h-dvh` instead of `h-screen` for full-height layouts
- Reserve space for async content to prevent layout shift
- Use `overflow-y-auto` on scrollable containers, not on `body`

## Summary

| Property | Mobile (base) | Desktop (`sm:`/`md:`) |
|---|---|---|
| Layout | `flex-col` | `md:flex-row` |
| Width | `w-full` | `sm:w-auto` / `sm:w-96` |
| Button | `w-full` | `sm:w-auto` |
| Input height | `h-11` | `sm:h-9` |
| Touch target | 44px minimum | relaxed |
| Sidebar | hidden (drawer) | visible |
| Dialog | full-screen | `sm:max-w-lg` |
| Hover actions | visible | `sm:opacity-0 sm:group-hover:opacity-100` |
