---
description: Documentation conventions — Mermaid validation, VitePress structure, content standards
globs: "website/**/*.md"
---

# Documentation Rules

## Mermaid Diagrams

- Always validate Mermaid syntax with `mcp__mermaider__validate_syntax` after writing
- Avoid special characters (`→`, `←`) in `stateDiagram-v2` note text — use plain ASCII
- Use `flowchart` for architecture, `sequenceDiagram` for interactions, `stateDiagram-v2` for lifecycles

## VitePress

- Every page must have YAML frontmatter with `title` and `description`
- Sidebar config: `website/.vitepress/config.mts`
- Custom styles: `website/.vitepress/theme/custom.css`

## Content Standards

- Document what IS implemented, not what is planned (mark planned features explicitly)
- Keep docs in sync with code — if a struct field changes, update the docs
- Include runnable examples (CLI commands with expected output)
- Use tables for reference material (config fields, env vars, CLI flags)
