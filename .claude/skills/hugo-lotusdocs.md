---
description: "Hugo + Lotus Docs documentation site management. Use when adding/editing docs pages, configuring the site, using shortcodes, or working with the landing page."
---

# Hugo + Lotus Docs

## Project Structure

```
docs/
├── hugo.toml                          # Site config
├── go.mod                             # Hugo module (Lotus Docs theme)
├── data/landing.yaml                  # Landing page sections
├── content/
│   ├── _index.md                      # Landing page (minimal frontmatter)
│   └── docs/
│       ├── _index.md                  # Docs section root
│       └── *.md                       # Doc pages
├── assets/
│   ├── images/logos/mark.svg          # Navbar logo (small)
│   ├── images/logos/logo.svg          # Navbar logo (expanded)
│   ├── images/mecha-512.png          # Hero image
│   ├── scss/_variables.scss           # Bootstrap variable overrides ($primary: #C56F52)
│   ├── scss/custom/pages/_features.scss  # Landing page style overrides
│   └── docs/scss/custom/colors/_terracotta.scss  # Docs accent color
├── static/
│   ├── favicon.svg                    # Browser tab icon (SVG)
│   ├── favicon.ico                    # Browser tab icon (ICO)
│   ├── favicon-32x32.png
│   ├── favicon-16x16.png
│   ├── apple-touch-icon.png
│   ├── site.webmanifest
│   └── images/icons/                  # Full icon set
└── layouts/partials/                  # Template overrides
    ├── head/favicon.html
    └── docs/head/favicon.html
```

## Build Commands

```bash
cd docs
hugo                    # Build to ../website/
hugo server             # Dev server on localhost:1313
hugo server --noHTTPCache --disableFastRender  # No cache
hugo --gc --cleanDestinationDir               # Clean build
```

Output dir: `../website/` (gitignored). Config: `publishDir = '../website'`.

## Adding a Doc Page

Create a markdown file in `docs/content/docs/`:

```markdown
---
title: "Page Title"
description: "One-line description for nav cards and SEO."
icon: article            # Material icon name
weight: 200              # Lower = higher in sidebar (increment by 100)
draft: false
toc: true                # Table of contents
---

## Content here

Regular markdown. Supports HTML if needed (unsafe mode enabled).
```

### Section (directory with child pages)

```
docs/content/docs/concepts/
├── _index.md            # Section page (required)
├── workers.md
└── tasks.md
```

Section `_index.md`:
```markdown
---
title: "Concepts"
description: "Core concepts behind Mecha."
icon: school
weight: 200
---
```

### Weight Convention

- Getting Started: 100
- Concepts: 200
- Guides: 300
- Reference: 400
- Contributing: 500

Increment by 100 between sections, by 10 within a section.

## Front Matter Icons

Use [Material Icons](https://fonts.google.com/icons) names:

| Icon | Name |
|------|------|
| Article | `article` |
| Rocket | `rocket_launch` |
| School | `school` |
| Code | `code` |
| Settings | `settings` |
| Shield | `shield` |
| Bolt | `bolt` |
| Build | `build` |

Set `sidebarIcons = true` and `titleIcon = true` in hugo.toml to display them.

## Shortcodes

### Alerts

```markdown
{{< alert text="Simple info alert." />}}

{{< alert context="success" text="Success message." />}}

{{< alert context="danger" text="Danger message." />}}

{{< alert context="warning" text="Warning message." />}}

{{< alert icon="🔒" context="info" text="Custom icon alert." />}}

{{% alert context="success" %}}
#### Markdown content
- Item one
- Item two
{{% /alert %}}
```

Contexts: `info`, `success`, `danger`, `warning`, `primary`, `light`, `dark`.

### Tabs

```markdown
{{< tabs tabTotal="3" >}}
{{% tab tabName="Go" %}}
` ` `go
fmt.Println("Hello")
` ` `
{{% /tab %}}
{{% tab tabName="Python" %}}
` ` `python
print("Hello")
` ` `
{{% /tab %}}
{{% tab tabName="TypeScript" %}}
` ` `typescript
console.log("Hello")
` ` `
{{% /tab %}}
{{< /tabs >}}
```

`tabTotal` must match the number of `tab` shortcodes.

### Tables

```markdown
{{< table "table-striped table-hover" >}}
| Column | Column |
|--------|--------|
| Data   | Data   |
{{< /table >}}
```

Options: `table-striped`, `table-hover`, `table-borderless`, `table-sm`, `table-responsive`.

## Landing Page

Configured in `docs/data/landing.yaml`. Sections:

### Hero

```yaml
hero:
  enable: true
  weight: 10
  template: hero
  badge:
    text: v0.1.0
    color: primary          # primary, secondary, success, danger, warning, info
    pill: false
    soft: true
  title: "Mecha"
  subtitle: Markdown-supported **subtitle** text.
  image:
    path: "images"          # Under assets/images/
    filename: "mecha-512.png"
    alt: "Mecha Logo"
    boxShadow: false
    rounded: false
  ctaButton:
    icon: rocket_launch     # Material icon
    btnText: "Get Started"
    url: "/docs/getting-started/"
  cta2Button:
    icon: code
    btnText: "View on GitHub"
    url: "https://github.com/xiaolai/mecha.im"
  info: "**Open Source** MIT Licensed."
```

### Feature Grid

```yaml
featureGrid:
  enable: true
  weight: 20
  template: feature grid
  title: Section Title
  subtitle: Section description.
  items:
    - title: Feature Name
      icon: bolt              # Material icon
      description: Feature description text.
```

### Disabling Theme Defaults

The theme ships a default `landing.yaml` with an `imageCompare` section. Override by setting `enable: false`:

```yaml
imageCompare:
  enable: false
```

## Theming

### Accent Color

Our custom terracotta color (#C56F52) is set in two places:

1. **Landing page**: `assets/scss/_variables.scss` — `$primary: #C56F52`
2. **Docs pages**: `assets/docs/scss/custom/colors/_terracotta.scss` — CSS variables
3. **hugo.toml**: `themeColor = "terracotta"`

### Custom CSS Overrides

Place SCSS files in `assets/scss/custom/` (landing) or `assets/docs/scss/custom/` (docs) to override theme styles. Files must match the theme's directory structure to be picked up.

### Logos

- `assets/images/logos/mark.svg` — Navbar icon (landing + docs sidebar)
- `assets/images/logos/logo.svg` — Expanded navbar logo with text
- Hero images go in `assets/images/`

### Favicons

Override in `static/`: `favicon.svg`, `favicon.ico`, `favicon-32x32.png`, `favicon-16x16.png`, `apple-touch-icon.png`, `site.webmanifest`.

Template overrides in `layouts/partials/head/favicon.html` and `layouts/partials/docs/head/favicon.html`.

## Key Config (hugo.toml)

```toml
[params.docs]
  title           = "Mecha"
  themeColor      = "terracotta"    # Custom color file name
  darkMode        = true
  prism           = true            # Syntax highlighting
  toc             = true            # Table of contents
  sidebarIcons    = true
  titleIcon       = true
  breadcrumbs     = true
  editPage        = true            # "Edit this page" link
  repoURL         = "https://github.com/xiaolai/mecha.im"
  repoBranch      = "main"

[params.flexsearch]
  enabled = true                    # Full-text search
```

## Common Tasks

### Add a new doc page
1. Create `docs/content/docs/page-name.md` with frontmatter
2. Set `weight` to control sidebar order
3. Build: `hugo` or let dev server auto-reload

### Add a new section
1. Create `docs/content/docs/section-name/_index.md`
2. Add child pages in the same directory
3. Set weights on both section and children

### Update landing page
1. Edit `docs/data/landing.yaml`
2. Hero images go in `docs/assets/images/` (not static)
3. Feature grid icons use Material Icons names

### Override theme styles
1. Landing page: `docs/assets/scss/custom/**`
2. Docs pages: `docs/assets/docs/scss/custom/**`
3. Match the theme's file structure for SCSS overrides
