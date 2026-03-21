# Max File Size Rule

No source file under `packages/*/src/` may exceed **350 lines of code** (excluding blank lines and comments).

When a file approaches 300 lines, proactively extract cohesive functionality into a new module. Common extraction targets:
- Type definitions → `types.ts`
- Pure utility functions → dedicated module
- Setup/initialization logic → `*-setup.ts`
