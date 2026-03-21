---
globs:
  - "packages/dashboard/**/*.tsx"
  - "packages/dashboard/**/*.ts"
  - "packages/dashboard/**/*.css"
  - "packages/ui/**/*.tsx"
---

# Design Constraints

Everything you must NOT do. One file, no exceptions scattered elsewhere.

## Colors

**NEVER** use raw color literals in component code: no `#hex`, `rgb()`, `rgba()`, `hsl()`, `oklch()`, and no Tailwind palette colors (`text-red-200`, `bg-black`, `bg-white`, `text-white`).

Always use semantic tokens (`text-foreground`, `bg-destructive`, `text-destructive-foreground`).

Raw oklch values belong ONLY in `globals.css` inside `:root` and `.dark` blocks.

```tsx
// WRONG
className="text-[#666]"
className="bg-white"
className="text-white"
className="dark:text-red-200"
style={{ color: "#4f46e5" }}

// RIGHT
className="text-muted-foreground"
className="bg-background"
className="text-destructive-foreground"
className="text-destructive"
className="text-primary"
```

## Spacing & Sizing

**NEVER** use arbitrary pixel/rem values. Use the Tailwind spacing scale (multiples of 4px).

```tsx
// WRONG
className="p-[13px]"
className="gap-[7px]"
className="w-[347px]"

// RIGHT
className="p-3"
className="gap-2"
className="w-full max-w-sm"
```

**Allowed exceptions:**
- Container max-widths matching a design breakpoint: `max-w-[1200px]`
- Fixed aspect ratios: `aspect-[4/3]`
- Grid template definitions: `grid-cols-[auto_1fr_auto]`

## Font Size & Weight

**NEVER** use arbitrary font sizes or weights. Use the Tailwind type scale.

```tsx
// WRONG
className="text-[15px]"
className="font-[450]"

// RIGHT
className="text-sm"
className="font-medium"
```

## Border Radius

**NEVER** use arbitrary radius values. Use theme tokens: `rounded-sm` → `rounded-md` → `rounded-lg` → `rounded-xl` → `rounded-full`.

## Shadows

**NEVER** use arbitrary shadow values. Use `shadow-sm`, `shadow-md`, `shadow-lg`.

## Opacity

**NEVER** use arbitrary opacity. Use Tailwind scale (`opacity-60`) or token slash syntax (`bg-background/15`).

## Z-Index

Use Tailwind scale only: `z-0`, `z-10`, `z-20`, `z-30`, `z-40`, `z-50`.

## Line Height & Letter Spacing

Use Tailwind's `leading-*` and `tracking-*` scales. No arbitrary values.

## Inline Styles

**NEVER** use `style={}` for visual properties.

**Two allowed exceptions:**
- Dynamic runtime values: `style={{ transform: \`translateX(${offset}px)\` }}`
- CSS custom property overrides: `style={{ "--progress": \`${percent}%\` } as React.CSSProperties}`

## Icons

**NEVER** use icons from other libraries (heroicons, react-icons, font-awesome).
**NEVER** use inline `<svg>` elements for icons — always import from `lucide-react`.

## Icon Buttons

Icon buttons MUST be icon-only (no visible text). Every icon button MUST have a tooltip or `aria-label`.

```tsx
// WRONG — icon button without tooltip
<Button variant="ghost" size="icon-sm">
  <TrashIcon />
</Button>

// WRONG — text + icon in an action button
<Button variant="ghost" size="sm">
  <TrashIcon /> Delete
</Button>

// RIGHT
<TooltipIconButton tooltip="Delete" variant="ghost" size="icon-sm">
  <TrashIcon />
</TooltipIconButton>
```

Use icon-specific sizes (`icon-xs`, `icon-sm`, `icon`, `icon-lg`) — never `size="sm"` or `size="default"` for icon-only buttons.

**Exceptions** — text + icon is allowed for:
- Primary action buttons ("New Mecha", "Save", "Submit")
- Navigation links with labels (sidebar items)
- Dialog action buttons ("Cancel", "Confirm")

## Layout Borders

**NEVER** use horizontal borders (`border-b`, `border-t`, `divide-y`) to separate columns in multi-column layouts — they misalign across columns. Use vertical borders (`border-r`, `border-l`) or spacing/background contrast instead.

## Styling Approach

- NEVER import CSS modules — Tailwind utilities only
- NEVER add `tailwind.config.ts` — config is in `globals.css` via `@theme inline`
- NEVER use `styled-components` or CSS-in-JS
- NEVER hardcode light/dark colors — use token pairs that auto-switch

## Quick Reference: What Goes Where

| Property | Source | Example |
|---|---|---|
| Colors | Design tokens | `text-foreground`, `bg-primary/80` |
| Spacing | Tailwind scale | `p-4`, `gap-2`, `mt-6` |
| Font size | Tailwind scale | `text-sm`, `text-lg` |
| Font weight | Tailwind scale | `font-medium`, `font-semibold` |
| Radius | Theme tokens | `rounded-md`, `rounded-lg` |
| Shadow | Tailwind scale | `shadow-sm`, `shadow-md` |
| Z-index | Tailwind scale | `z-10`, `z-50` |
| Breakpoints | Tailwind screens | `sm:`, `md:`, `lg:` |
| Icons | lucide-react | `<CopyIcon className="size-4" />` |
| Raw values | `globals.css` only | `:root { --my-token: ... }` |
