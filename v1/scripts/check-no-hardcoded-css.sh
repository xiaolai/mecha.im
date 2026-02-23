#!/usr/bin/env bash
# Pre-commit check: no hard-coded CSS values in dashboard/ui components
# Install: ln -sf ../../scripts/check-no-hardcoded-css.sh .git/hooks/pre-commit

set -euo pipefail

# Only check staged files in dashboard/ui packages
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM -- \
  'packages/dashboard/src/**/*.tsx' \
  'packages/dashboard/src/**/*.ts' \
  'packages/dashboard/src/**/*.css' \
  'packages/ui/**/*.tsx' \
  2>/dev/null || true)

# Skip shadcn UI primitives (auto-generated)
STAGED_FILES=$(echo "$STAGED_FILES" | grep -v 'components/ui/' || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

ERRORS=0
ERROR_LOG=""

check_pattern() {
  local pattern="$1"
  local desc="$2"
  local suggestion="$3"
  local file="$4"
  local content="$5"

  local matches
  matches=$(echo "$content" | grep -nE "$pattern" 2>/dev/null || true)

  if [ -n "$matches" ]; then
    while IFS= read -r match; do
      local line_num line_content
      line_num=$(echo "$match" | cut -d: -f1)
      line_content=$(echo "$match" | cut -d: -f2- | sed 's/^[[:space:]]*//')

      ERRORS=$((ERRORS + 1))
      ERROR_LOG+="  ${file}:${line_num}
    ${desc}
    > ${line_content}
    Fix: ${suggestion}

"
    done <<< "$matches"
  fi
}

for file in $STAGED_FILES; do
  CONTENT=$(git show ":$file" 2>/dev/null || true)
  [ -z "$CONTENT" ] && continue

  # Arbitrary font sizes
  check_pattern 'text-\[[0-9]+px\]' \
    "Arbitrary font size" \
    "Use text-xs (12px), text-sm (14px), text-base (16px), text-lg (18px)" \
    "$file" "$CONTENT"

  check_pattern 'text-\[[0-9.]+r?em\]' \
    "Arbitrary font size (em/rem)" \
    "Use text-xs, text-sm, text-base, text-lg" \
    "$file" "$CONTENT"

  # Arbitrary font weight
  check_pattern 'font-\[[0-9]+\]' \
    "Arbitrary font weight" \
    "Use font-normal (400), font-medium (500), font-semibold (600), font-bold (700)" \
    "$file" "$CONTENT"

  # Hard-coded colors
  check_pattern '(bg|text|border|ring|outline|from|to|via)-\[#[0-9a-fA-F]' \
    "Hard-coded hex color" \
    "Use semantic tokens: bg-primary, text-foreground, border-border, etc." \
    "$file" "$CONTENT"

  check_pattern '(bg|text|border)-\[rgba?\(' \
    "Hard-coded rgb/rgba color" \
    "Use semantic tokens with opacity: bg-primary/50, text-muted-foreground" \
    "$file" "$CONTENT"

  check_pattern '(bg|text|border)-\[oklch\(' \
    "Hard-coded oklch color" \
    "Define in globals.css :root, reference via token" \
    "$file" "$CONTENT"

  check_pattern '(bg|text|border)-\[hsl' \
    "Hard-coded hsl color" \
    "Use semantic tokens" \
    "$file" "$CONTENT"

  # Arbitrary spacing
  check_pattern 'tracking-\[[0-9.]' \
    "Arbitrary letter spacing" \
    "Use tracking-tight, tracking-normal, tracking-wide, tracking-wider, tracking-widest" \
    "$file" "$CONTENT"

  check_pattern 'leading-\[[0-9.]' \
    "Arbitrary line height" \
    "Use leading-none, leading-tight, leading-snug, leading-normal, leading-relaxed" \
    "$file" "$CONTENT"

  # Arbitrary border radius
  check_pattern 'rounded-\[[0-9]+' \
    "Arbitrary border radius" \
    "Use rounded-sm (6px), rounded-md (8px), rounded-lg (10px), rounded-xl (14px), rounded-full" \
    "$file" "$CONTENT"

  # Arbitrary shadow
  check_pattern 'shadow-\[[0-9]' \
    "Arbitrary shadow" \
    "Use shadow-sm, shadow-md, shadow-lg" \
    "$file" "$CONTENT"

  # Arbitrary z-index
  check_pattern 'z-\[[0-9]+\]' \
    "Arbitrary z-index" \
    "Use z-0, z-10, z-20, z-30, z-40, z-50" \
    "$file" "$CONTENT"

  # Arbitrary opacity
  check_pattern 'opacity-\[[0-9.]+\]' \
    "Arbitrary opacity" \
    "Use opacity scale: opacity-0, opacity-5, opacity-10, ..., opacity-100" \
    "$file" "$CONTENT"

  # Inline style with visual properties (not CSS variables or dynamic transforms)
  check_pattern 'style=\{\{[^}]*(color|background|fontSize|fontWeight|padding|margin|border|borderRadius|shadow|opacity|zIndex|letterSpacing|lineHeight)\s*:' \
    "Inline style with visual property" \
    "Use Tailwind classes instead of inline styles" \
    "$file" "$CONTENT"
done

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "=========================================="
  echo "  NO HARD-CODED CSS VALUES"
  echo "=========================================="
  echo ""
  echo "$ERROR_LOG"
  echo "=========================================="
  echo "  $ERRORS violation(s) found. Commit blocked."
  echo ""
  echo "  All visual values must use design system tokens."
  echo "  See: .claude/rules/no-hardcoded-values.md"
  echo "=========================================="
  echo ""
  exit 1
fi

exit 0
