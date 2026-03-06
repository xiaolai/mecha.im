---
title: Dashboard SPA
description: Complete reference for the Mecha dashboard single-page application — pages, components, hooks, and utilities.
---

# Dashboard SPA

The Mecha dashboard is a React single-page application (SPA) embedded in the agent binary. It provides a browser-based interface for managing bots, sessions, schedules, nodes, auth profiles, budgets, plugins, tools, and system settings. Authentication is via TOTP (time-based one-time password).

**Source:** `packages/spa/src/`

## Architecture

The SPA is built with React 19 + React Router + Tailwind CSS v4. It is served from the agent's unified HTTP port (default `7660`). All API calls use session cookies set at login.

### Provider Stack

The app mounts the following provider hierarchy in `main.tsx`:

```
StrictMode
  BrowserRouter
    ThemeProvider (next-themes, light mode)
      TooltipProvider (300ms delay)
        AuthProvider
          App
```

## App & Auth

### `App`

**File:** `src/app.tsx`

Root routing component. Shows `LoginPage` when unauthenticated, or the `DashboardLayout` with nested routes when authenticated. Displays a skeleton loader while auth status is being probed.

### `AuthProvider`

**File:** `src/auth-context.tsx`

React context provider that manages TOTP authentication state. On mount, fetches `/auth/status` to discover available auth methods, then probes the session cookie by calling `/bots`. Provides the `useAuth` hook to all descendants.

### `useAuth`

**File:** `src/auth-context.tsx`

```ts
function useAuth(): AuthContextValue
```

Returns the current authentication context. Throws if used outside `AuthProvider`.

| Property | Type | Description |
|---|---|---|
| `authenticated` | `boolean` | Whether the user has a valid TOTP session |
| `authMode` | `"totp" \| null` | Active auth mode |
| `authHeaders` | `Record<string, string>` | Headers for API requests (empty; cookie handles auth) |
| `setTotpAuthenticated` | `() => void` | Mark session as authenticated |
| `logout` | `() => void` | Clear session and call `POST /auth/logout` |
| `availableMethods` | `{ totp: boolean }` | Server-reported auth methods |
| `loading` | `boolean` | True while fetching `/auth/status` |

## Pages

All authenticated pages render inside `DashboardLayout`, which provides the sidebar and topbar.

| Page | Route | File | Description |
|---|---|---|---|
| `HomePage` | `/` | `pages/home.tsx` | Bot list with meter summary, spawn form, and batch actions. Supports `?node=` filter. |
| `BotDetailPage` | `/bot/:name` | `pages/bot-detail.tsx` | Delegates to `BotDetail` component with route params. |
| `SessionDetailPage` | `/bot/:name/session/:id` | `pages/session-detail.tsx` | Displays a session's transcript via `ConversationView`. Shows session title, timestamps, and a link to attach a terminal. |
| `TerminalPage` | `/bot/:name/terminal` | `pages/terminal.tsx` | Full-screen xterm.js terminal with session selector. Supports `?session=` and `?node=` query params. |
| `NodesPage` | `/nodes` | `pages/nodes.tsx` | Mesh node management via `NodesView`. |
| `SchedulesPage` | `/schedules` | `pages/schedules-page.tsx` | Cross-bot schedule overview via `ScheduleOverview`. |
| `AclPage` | `/acl` | `pages/acl.tsx` | ACL rule management via `AclView`. |
| `AuditPage` | `/audit` | `pages/audit.tsx` | Tabbed view with Events and Audit tabs. |
| `BudgetsPage` | `/budgets` | `pages/budgets.tsx` | Budget configuration via `BudgetsView`. |
| `AuthProfilesPage` | `/auth` | `pages/auth-profiles.tsx` | Auth profile management via `AuthProfilesView`. |
| `SandboxPage` | `/sandbox` | `pages/sandbox.tsx` | Per-bot sandbox inspection via `SandboxView`. |
| `PluginsPage` | `/plugins` | `pages/plugins.tsx` | MCP plugin management via `PluginsView`. |
| `ToolsPage` | `/tools` | `pages/tools.tsx` | Tool registry via `ToolsView`. |
| `DoctorPage` | `/doctor` | `pages/doctor.tsx` | System diagnostics via `DoctorView`. |
| `SettingsPage` | `/settings` | `pages/settings.tsx` | System settings via `SettingsView`. |
| `LoginPage` | (no route; shown when unauthenticated) | `pages/login.tsx` | TOTP login with 6-digit code input. Auto-submits when all digits are filled. Supports paste. |
| `NotFoundPage` | `*` | `pages/not-found.tsx` | 404 page with link back to dashboard. |

### `DashboardLayout`

**File:** `src/pages/dashboard-layout.tsx`

Layout wrapper with sidebar (collapsible on mobile) and topbar. Renders child routes via React Router's `<Outlet />`.

### `PageShell`

**File:** `src/components/page-shell.tsx`

```ts
function PageShell({ title, children }: { title: string; children: React.ReactNode }): JSX.Element
```

Simple page wrapper that renders a heading and children in a vertical layout. Used by most non-bot pages.

## Layout Components

### `Sidebar`

**File:** `src/components/layout/sidebar.tsx`

| Prop | Type | Description |
|---|---|---|
| `open` | `boolean` | Whether the sidebar is visible (mobile only) |
| `onClose` | `() => void` | Called to close the mobile drawer |

Navigation sidebar with four sections: **Bots** (Bots, Schedules, Budgets), **Security** (ACL Rules, Auth Profiles, Sandbox), **Infrastructure** (Nodes, Plugins, Tools), **System** (Audit & Events, Doctor, Settings). Includes a logout button in the footer. On mobile, renders as an off-canvas drawer with overlay.

### `Topbar`

**File:** `src/components/layout/topbar.tsx`

| Prop | Type | Description |
|---|---|---|
| `onMenuClick` | `() => void` | Opens the mobile sidebar drawer |

Mobile-only header bar (`md:hidden`) with a hamburger menu button and "mecha" branding.

## Bot Components

### `BotCard`

**File:** `src/components/bot-card.tsx`

Displays a single bot as a card with status dot, name, node, port, auth key, home directory, hostname/IP, uptime, cost, tags, and lifecycle action buttons (start/stop/restart/kill/remove). The entire card is clickable to navigate to the bot detail page.

| Prop | Type | Description |
|---|---|---|
| `bot` | `BotInfo` | Bot status object |

**`BotInfo` interface:**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Bot name |
| `state` | `"running" \| "stopped" \| "error"` | Current state |
| `pid` | `number?` | Process ID |
| `port` | `number?` | Assigned port |
| `workspacePath` | `string?` | Workspace directory |
| `startedAt` | `string?` | ISO timestamp |
| `stoppedAt` | `string?` | ISO timestamp |
| `exitCode` | `number?` | Last exit code |
| `tags` | `string[]?` | User-defined tags |
| `node` | `string?` | Node name (`"local"` or remote) |
| `hostname` | `string?` | Machine hostname |
| `lanIp` | `string?` | LAN IP address |
| `tailscaleIp` | `string?` | Tailscale IP address |
| `homeDir` | `string?` | Home directory path |
| `model` | `string?` | Claude model identifier |
| `sandboxMode` | `string?` | Sandbox mode (`auto`, `off`, `require`) |
| `permissionMode` | `string?` | Permission mode |
| `auth` | `string?` | Auth profile name |
| `authType` | `"oauth" \| "api-key"?` | Auth type |
| `costToday` | `number?` | Today's API cost in USD |

### `BotDetail`

**File:** `src/components/bot-detail.tsx`

Full bot detail view. Polls `/bots/:name/status` every 5 seconds. Shows overview cards (port, workspace, started time, model, auth switcher, cost), tags, and tabbed content: Sessions, Schedules, Config (path editor + config editor + JSON view), and Logs.

| Prop | Type | Description |
|---|---|---|
| `name` | `string` | Bot name |
| `node` | `string?` | Node name for remote bots |

### `BotList`

**File:** `src/components/bot-list.tsx`

Grid of `BotCard` components. Polls `/bots` every 5 seconds. Supports tag filtering with pill-style toggle buttons.

| Prop | Type | Description |
|---|---|---|
| `node` | `string?` | Filter to bots on a specific node |

### `BotSpawnForm`

**File:** `src/components/bot-spawn-form.tsx`

Slide-out sheet form for creating a new bot. Fields: name, workspace path, auth profile (dropdown), tags, sandbox mode, permission mode, model, mesh expose capabilities, and metering toggle.

| Prop | Type | Description |
|---|---|---|
| `open` | `boolean` | Whether the sheet is visible |
| `onOpenChange` | `(open: boolean) => void` | Sheet visibility handler |
| `onCreated` | `() => void` | Called after successful creation |

### `BotLogsView`

**File:** `src/components/bot-logs-view.tsx`

Displays bot stdout/stderr logs with stream toggle. Polls every 5 seconds, showing the last 500 lines.

| Prop | Type | Description |
|---|---|---|
| `name` | `string` | Bot name |

## Session Components

### `SessionList`

**File:** `src/components/session-list.tsx`

Table of sessions for a given bot. Links each row to the session detail page. Only fetches when the bot is running.

| Prop | Type | Description |
|---|---|---|
| `name` | `string` | Bot name |
| `node` | `string?` | Node name for remote bots |
| `botState` | `string?` | Current bot state (skips fetch if stopped) |

### `SessionSelector`

**File:** `src/components/session-selector.tsx`

Dropdown `<select>` for choosing or creating sessions on the terminal page. Polls session list every 10 seconds. Includes a "New Session" option.

| Prop | Type | Description |
|---|---|---|
| `botName` | `string` | Bot name |
| `node` | `string?` | Node name |
| `currentSessionId` | `string?` | Currently selected session |
| `botState` | `string?` | Bot state |
| `onSelect` | `(id: string \| undefined) => void` | Called when a session is selected (`undefined` for new) |

### `ConversationView`

**File:** `src/components/conversation-view.tsx`

Renders a session transcript as a chat-style conversation. Supports two modes: **Messages** (cleaned user/assistant bubbles with markdown rendering, tool use summaries) and **Full transcript** (all events including tool inputs/results, raw JSON).

| Prop | Type | Description |
|---|---|---|
| `events` | `TranscriptEvent[]` | Array of transcript events |

### `Terminal`

**File:** `src/components/terminal.tsx`

Embedded xterm.js terminal that connects to the bot's PTY session via WebSocket. Supports light/dark themes, session creation callbacks, and exit handling.

| Prop | Type | Description |
|---|---|---|
| `botName` | `string` | Bot name |
| `sessionId` | `string?` | Session to attach to (or creates new) |
| `node` | `string?` | Node name for remote bots |
| `onSessionCreated` | `(id: string) => void` | Called when server assigns a session ID |
| `onExit` | `(code: number) => void` | Called when the PTY session exits |

## Node Components

### `NodesView`

**File:** `src/components/nodes-view.tsx`

Grid of node cards with health status, system info, network details, and resource metrics. Polls `/mesh/nodes` every 30 seconds. Supports ping, remove, and promote (discovered to manual) actions. Clicking a node card navigates to `/?node=<name>`.

### `NodeAddForm`

**File:** `src/components/node-add-form.tsx`

Slide-out sheet form for registering a remote mesh node. Fields: name, host, port (default 7660), API key.

| Prop | Type | Description |
|---|---|---|
| `open` | `boolean` | Whether the sheet is visible |
| `onOpenChange` | `(open: boolean) => void` | Sheet visibility handler |
| `onAdded` | `() => void` | Called after successful registration |

### `NodeNameEditor`

**File:** `src/components/node-name-editor.tsx`

Inline-editable node name. Shows the current name with a pencil icon; click to edit in-place with save/cancel.

| Prop | Type | Description |
|---|---|---|
| `currentName` | `string` | The node's current name |

## Schedule Components

### `ScheduleList`

**File:** `src/components/schedule-list.tsx`

Per-bot schedule list with expandable rows. Each row shows schedule ID, interval, status, and action buttons (run now, pause/resume, delete). Expanding a row shows `ScheduleHistory`. Includes an inline `ScheduleAddForm`.

| Prop | Type | Description |
|---|---|---|
| `botName` | `string` | Bot name |
| `node` | `string?` | Node name |
| `botState` | `string?` | Bot state (disabled when not running) |

### `ScheduleAddForm`

**File:** `src/components/schedule-add-form.tsx`

Inline form for creating a schedule. Fields: schedule ID, interval (format: `30s`, `5m`, `1h`), and prompt text. Validates ID format and interval range (10s to 24h).

| Prop | Type | Description |
|---|---|---|
| `botName` | `string` | Bot name |
| `node` | `string?` | Node name |
| `onAdded` | `() => void` | Called after successful creation |
| `onCancel` | `() => void` | Called when the user cancels |

### `ScheduleOverview`

**File:** `src/components/schedule-overview.tsx`

Cross-bot schedule overview. Fetches `/bots/schedules/overview` and displays all schedules across all bots in a responsive table/card layout. Each row has run/pause/delete actions. Shows stale data with a non-blocking error banner when polling fails.

### `ScheduleHistory`

**File:** `src/components/schedule-history.tsx`

Displays the last 10 execution results for a specific schedule. Each row shows relative time, outcome badge (success/error/skipped), and duration.

| Prop | Type | Description |
|---|---|---|
| `botName` | `string` | Bot name |
| `scheduleId` | `string` | Schedule ID |
| `node` | `string?` | Node name |
| `refreshToken` | `number?` | Incremented to trigger re-fetch (e.g., after "Run now") |

## Auth Components

### `AuthSwitcher`

**File:** `src/components/auth-switcher.tsx`

Popover-based auth profile switcher shown on the bot detail page. Implements a state machine: list profiles, confirm restart (for running bots), or confirm force restart (when bot is busy). Calls `PATCH /bots/:name/config` to switch profiles.

| Prop | Type | Description |
|---|---|---|
| `botName` | `string` | Bot name |
| `currentAuth` | `string?` | Current auth profile name |
| `currentAuthType` | `string?` | Current auth type |
| `botState` | `string` | Bot state |
| `node` | `string?` | Node name |
| `onSwitched` | `() => void` | Called after successful switch |

### `ProfileList`, `ConfirmView`, `ForceConfirmView`

**File:** `src/components/auth-switcher-panels.tsx`

Sub-panels for `AuthSwitcher`:

- **`ProfileList`** -- Renders the list of available auth profiles with selection, expired token warnings, and a "Use default profile" option.
- **`ConfirmView`** -- Confirmation panel asking whether to "Switch & Restart" or "Just Save".
- **`ForceConfirmView`** -- Warning panel for force-restarting when active sessions are running.

**`AuthProfile` interface** (exported):

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Profile name |
| `type` | `"oauth" \| "api-key"` | Auth type |
| `label` | `string?` | Display label |
| `isDefault` | `boolean` | Whether this is the default profile |
| `tags` | `string[]?` | Tags |
| `expiresAt` | `number \| null?` | Token expiration timestamp |

### `AuthProfilesView`

**File:** `src/components/auth-profiles-view.tsx`

Full auth profiles management page. Lists profiles in a table with columns: Name, Type, Source, Status, and Actions (test, set default, delete). Includes an inline create form.

### `AuthProfilesSection`

**File:** `src/components/auth-profiles-section.tsx`

Card-based auth profiles section used on the settings page. Shows stored profiles with test/default/renew/remove actions, and environment-sourced profiles as read-only. Uses `AddProfileDialog` and `RenewTokenDialog`.

### `AddProfileDialog`, `RenewTokenDialog`

**File:** `src/components/auth-profile-dialogs.tsx`

- **`AddProfileDialog`** -- Modal dialog for creating a new auth profile. Fields: name, type (API Key / OAuth toggle), and token (with show/hide toggle).
- **`RenewTokenDialog`** -- Modal dialog for replacing an existing profile's token.

## Settings Components

### `SettingsView`

**File:** `src/components/settings-view.tsx`

Dashboard settings page with cards in a 2-column grid:

- **This Node** -- Node name (editable), hostname, OS, CPUs, memory, active bots, uptime.
- **Dashboard Auth (TOTP)** -- TOTP status and source.
- **Meter Daemon** -- Meter status with start/stop toggle, port, PID, uptime.
- **Network** -- Agent port, IPs, force-HTTPS toggle.
- **Runtime** -- Bot port range, MCP port.
- **Auto-Discovery** -- Tailscale peer discovery status and counts.
- **Auth Profiles** -- Link to the `/auth` page.

### `PluginsView`

**File:** `src/components/plugins-view.tsx`

MCP plugin management. Displays plugins as cards with type icon, name, badge, description, URL/command, and test result. Supports add (stdio/http/sse types), test connectivity, and remove actions.

### `SandboxView`

**File:** `src/components/sandbox-view.tsx`

Per-bot sandbox configuration inspector. Dropdown to select a bot, then displays sandbox mode, hook scripts, and raw settings JSON.

### `AclView`

**File:** `src/components/acl-view.tsx`

ACL rule management. Grant form (source, target, capability dropdown) and rules table. Each capability badge has an inline revoke button. Available capabilities: `query`, `read_workspace`, `write_workspace`, `execute`, `read_sessions`, `lifecycle`.

### `AuditView`

**File:** `src/components/audit-view.tsx`

MCP audit log table. Columns: Time, Tool, Client, Result (ok/error/rate-limited), Duration. Polls `/audit?limit=100` every 10 seconds.

### `EventsView`

**File:** `src/components/events-view.tsx`

System event log table. Columns: Time, Severity (info/warn/error), Category, Event, Message. Polls `/events/log?limit=100` every 10 seconds.

### `MeterSummary`

**File:** `src/components/meter-summary.tsx`

Summary cards displayed on the home page showing today's: requests (with error count), cost in USD, token counts (input/output), and average latency. Polls `/meter/cost` every 30 seconds.

### `BudgetsView`

**File:** `src/components/budgets-view.tsx`

Budget configuration manager. Supports global, per-bot, per-auth-profile, and per-tag scopes with daily and monthly USD limits. Set/remove budgets displayed as cards in a grid.

### `DoctorView`

**File:** `src/components/doctor-view.tsx`

System diagnostics runner. Click "Run Diagnostics" to call `GET /doctor`. Displays a list of checks with status icons (ok/warn/error), check name, and message.

### `ToolsView`

**File:** `src/components/tools-view.tsx`

Tool registry management. Table with columns: Name, Version, Description, and a remove button. Includes an install form with name, version, and description fields.

## Feedback Components

### `BusyWarningBanner`

**File:** `src/components/busy-warning-banner.tsx`

Warning banner shown when a stop/restart action detects active sessions. Displays active session count and last activity time. Offers "Force Restart"/"Force Stop" and "Cancel" buttons.

| Prop | Type | Description |
|---|---|---|
| `warning` | `BusyWarning` | Warning details (active sessions, last activity, pending action) |
| `onConfirm` | `() => void` | Force the action |
| `onCancel` | `() => void` | Dismiss the warning |
| `acting` | `boolean` | Whether an action is in progress |

### `ConfirmActionBanner`

**File:** `src/components/confirm-action-banner.tsx`

Confirmation banner for destructive bot actions (stop, restart, kill). Shows a description of the action and confirm/cancel buttons.

| Prop | Type | Description |
|---|---|---|
| `action` | `BotActionType` | The action to confirm |
| `name` | `string` | Bot name |
| `onConfirm` | `() => void` | Execute the action |
| `onCancel` | `() => void` | Dismiss |
| `acting` | `boolean` | Whether an action is in progress |

### `BatchActionDialog`

**File:** `src/components/batch-action-dialog.tsx`

Modal dialog for batch stop/restart of all bots. Implements a phased flow: preflight dry-run, review, execute, and done. Handles busy bots with "Force" and "Idle Only" options. Shows per-bot status with retry capability for failures.

| Prop | Type | Description |
|---|---|---|
| `action` | `"stop" \| "restart"` | Batch action type |
| `open` | `boolean` | Whether the dialog is open |
| `onOpenChange` | `(open: boolean) => void` | Dialog visibility handler |
| `onComplete` | `() => void` | Called when batch completes (optional) |

## Hooks

### `useFetch<T>`

**File:** `src/lib/use-fetch.ts`

```ts
function useFetch<T>(url: string | null, opts?: UseFetchOptions): UseFetchResult<T>
```

Generic data fetching hook with loading/error state, abort on unmount, optional polling, and automatic session cookie auth. Pass `null` as URL to skip fetching.

| Option | Type | Description |
|---|---|---|
| `interval` | `number?` | Polling interval in ms (omit for one-shot) |
| `deps` | `unknown[]?` | Additional dependencies that trigger re-fetch |

| Return | Type | Description |
|---|---|---|
| `data` | `T \| null` | Fetched data |
| `loading` | `boolean` | True during initial fetch (not background polls) |
| `error` | `string \| null` | Error message |
| `refetch` | `() => Promise<void>` | Manually trigger a re-fetch |

### `useBotAction`

**File:** `src/lib/use-bot-action.ts`

```ts
function useBotAction(
  name: string,
  onDone?: () => void,
  node?: string,
): UseBotActionResult
```

Bot lifecycle action hook with confirmation flow, busy-warning handling, and force-action support. Actions requiring confirmation: `stop`, `restart`, `kill`.

| Return | Type | Description |
|---|---|---|
| `acting` | `boolean` | Whether an action is in flight |
| `actionError` | `string \| null` | Error message |
| `busyWarning` | `BusyWarning \| null` | Set when server returns `BOT_BUSY` |
| `pendingConfirm` | `BotActionType \| null` | Action awaiting user confirmation |
| `handleAction` | `(action, opts?) => Promise<void>` | Initiate an action (shows confirmation for stop/restart/kill) |
| `confirmAction` | `() => Promise<void>` | Execute the pending confirmed action |
| `dismissConfirm` | `() => void` | Cancel the confirmation |
| `confirmForce` | `() => Promise<void>` | Force-execute despite busy warning |
| `dismissBusy` | `() => void` | Dismiss the busy warning |

## Utility Functions

### `cn`

**File:** `src/lib/utils.ts`

```ts
function cn(...inputs: ClassValue[]): string
```

Combines class names using `clsx` and deduplicates Tailwind classes using `tailwind-merge`.

### `shortModelName`

**File:** `src/lib/format.ts`

```ts
function shortModelName(model: string): string
// "claude-sonnet-4-5-20250514" => "sonnet-4-5"
```

Strips the `claude-` prefix and trailing date from model identifiers for compact display.

### `formatCost`

**File:** `src/lib/format.ts`

```ts
function formatCost(usd: number): string
// 0.005 => "<$0.01", 1.5 => "$1.50"
```

Formats a USD cost value for display.

### `formatUptime`

**File:** `src/lib/format.ts`

```ts
function formatUptime(seconds: number): string
// 3700 => "1h 1m", 90000 => "1d 1h"
```

Formats an uptime duration from seconds into a human-readable string.

### `formatUptimeFromIso`

**File:** `src/lib/format.ts`

```ts
function formatUptimeFromIso(iso: string): string
```

Computes and formats uptime from an ISO date string to now.

### `relativeTime`

**File:** `src/lib/format.ts`

```ts
function relativeTime(iso: string): string
// "2h ago", "just now", "in 3m"
```

Formats a timestamp as relative time from now, supporting both past and future dates.

### `humanizeProfileName`

**File:** `src/lib/auth-utils.ts`

```ts
function humanizeProfileName(name: string): string
// "$env:api-key" => "API Key (env)"
```

Converts raw auth profile names to human-friendly labels.

### `isExpired`

**File:** `src/lib/auth-utils.ts`

```ts
function isExpired(expiresAt: number | null | undefined): boolean
```

Returns `true` if an auth profile's token has expired.

### `authTypeIcon`

**File:** `src/lib/auth-utils.ts`

```ts
function authTypeIcon(type: "oauth" | "api-key" | string | undefined): React.ReactElement | null
```

Returns a small `KeyRoundIcon` or `ShieldCheckIcon` element for the given auth type.

### `stateStyles`

**File:** `src/lib/bot-styles.ts`

```ts
const stateStyles: Record<"running" | "stopped" | "error", { dot: string; badge: string }>
```

Maps bot states to CSS classes for status dots and badge variants. Used by `BotCard` and `BotDetail`.

| State | Dot Class | Badge Variant |
|---|---|---|
| `running` | `bg-success` | `success` |
| `stopped` | `bg-muted-foreground` | `secondary` |
| `error` | `bg-destructive` | `destructive` |

## UI Primitives

All UI primitives are in `src/components/ui/` and follow shadcn/ui conventions (Radix primitives + CVA variants).

### `AlertDialog`

**File:** `src/components/ui/alert-dialog.tsx`

Radix-based alert dialog. Exports: `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`.

### `Badge`

**File:** `src/components/ui/badge.tsx`

Pill-shaped status indicator with CVA variants.

| Variant | Style |
|---|---|
| `default` | Blue primary tint |
| `secondary` | Gray background |
| `destructive` | Red tint |
| `success` | Green tint |
| `warning` | Yellow tint |
| `outline` | Border only |

### `Button`

**File:** `src/components/ui/button.tsx`

Standard button with variants (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`) and sizes (`default`, `xs`, `sm`, `lg`, `icon-xs`, `icon-sm`, `icon`, `icon-lg`).

### `Checkbox`

**File:** `src/components/ui/checkbox.tsx`

Radix checkbox with check icon indicator.

### `Input`

**File:** `src/components/ui/input.tsx`

Styled text input with consistent height, border, and focus ring.

### `Label`

**File:** `src/components/ui/label.tsx`

Radix label with disabled state styling.

### `Popover`

**File:** `src/components/ui/popover.tsx`

Radix popover. Exports: `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`.

### `Select`

**File:** `src/components/ui/select.tsx`

Radix select dropdown. Exports: `Select`, `SelectGroup`, `SelectValue`, `SelectTrigger`, `SelectContent`, `SelectLabel`, `SelectItem`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton`.

### `Sheet`

**File:** `src/components/ui/sheet.tsx`

Radix dialog-based slide-out panel. Exports: `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`, `SheetClose`.

### `Skeleton`

**File:** `src/components/ui/skeleton.tsx`

Loading placeholder with pulse animation.

### `Table`

**File:** `src/components/ui/table.tsx`

HTML table with consistent styling. Exports: `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption`.

### `Tabs`

**File:** `src/components/ui/tabs.tsx`

Radix tabs. Exports: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`.

### `Tooltip`

**File:** `src/components/ui/tooltip.tsx`

Radix tooltip. Exports: `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent`.

### `TooltipIconButton`

**File:** `src/components/ui/tooltip-icon-button.tsx`

Convenience wrapper: a `Button` inside a `Tooltip`. Every icon-only button must use this component to ensure accessible labels and tooltip hints.

| Prop | Type | Description |
|---|---|---|
| `tooltip` | `string` | Tooltip text (also used as `aria-label`) |
| ...rest | `ButtonProps` | All standard button props |
