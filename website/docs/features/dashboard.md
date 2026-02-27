# Dashboard

The web dashboard provides a graphical interface for managing your mecha runtime.

## Quick Start

```bash
mecha dashboard serve
```

Opens the dashboard at [http://localhost:3457](http://localhost:3457).

## Architecture

The dashboard runs as a Next.js application started by the CLI. It creates a `ProcessManager` in the same process — no separate daemon or API server is needed. This matches the local-first design principle.

```
mecha dashboard serve
  └── ProcessManager (in-process)
  └── Next.js (port 3457)
       ├── /api/casas → casaFind()
       └── / → CASA list UI
```

## Features

### CASA List

The home page shows all CASAs with their status, port, and tags. Cards update every 5 seconds via polling. You can stop or kill running CASAs directly from the UI.

### Dark Mode

Toggle between light and dark themes using the button in the top bar. The dashboard respects your system preference by default.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | 3457 | Dashboard port |
| `--host` | 127.0.0.1 | Bind address |
| `--open` | false | Open browser after starting |

## Planned Features

- CASA detail view with sessions and configuration (Phase 7d-2)
- Chat interface with SSE streaming (Phase 7d-3)
- Mesh topology visualization (Phase 7d-4)
- ACL rule viewer (Phase 7d-4)
- Audit log and metering dashboard (Phase 7d-5)
