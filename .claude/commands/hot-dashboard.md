Build the bot dashboard and hot-deploy to a running bot's Docker container for live preview.

## Instructions

1. Parse the argument as a bot name. Default to `posca` if no argument given: `$ARGUMENTS`
2. Build the dashboard: `cd agent/dashboard && npx vite build` (must cd first — Tailwind content globs resolve relative to cwd)
3. Read `~/.mecha/registry.json` to find the bot's `path` field
4. Deploy: `rm -rf <path>/dashboard-dist && cp -r agent/dashboard/dist <path>/dashboard-dist`
5. Tell the user to refresh the browser. No container restart needed — the bot serves from `/state/dashboard-dist/` automatically via hot-reload.
