import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon, PlayIcon, RefreshCwIcon, SquareIcon, OctagonXIcon, TerminalSquareIcon, Loader2Icon } from "lucide-react";
import { AuthSwitcher } from "@/components/auth-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SessionList } from "@/components/session-list";
import { ScheduleList } from "@/components/schedule-list";
import { BotLogsView } from "@/components/bot-logs-view";
import { BusyWarningBanner } from "@/components/busy-warning-banner";
import { ConfirmActionBanner } from "@/components/confirm-action-banner";
import { BotFiles } from "@/components/bot-files";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";
import { useBotAction } from "@/lib/use-bot-action";
import { stateStyles } from "@/lib/bot-styles";
import { shortModelName, formatCost } from "@/lib/format";
import type { BotInfo } from "./bot-card";

interface BotDetailProps {
  name: string;
  node?: string;
}

export function BotDetail({ name, node }: BotDetailProps) {
  const isRemote = !!node && node !== "local";
  const nodeQuery = isRemote ? `?node=${encodeURIComponent(node)}` : "";
  const { data: bot, loading, error, refetch } = useFetch<BotInfo>(
    `/bots/${encodeURIComponent(name)}/status${nodeQuery}`,
    { interval: 5000, deps: [name, node] },
  );

  const { acting, actionError, busyWarning, pendingConfirm, handleAction, confirmAction, dismissConfirm, confirmForce, dismissBusy } = useBotAction(name, refetch, node);

  if (loading && !bot) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error || !bot) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Back to bots
        </Link>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? "bot not found"}
        </div>
      </div>
    );
  }

  const style = stateStyles[bot.state] ?? stateStyles.error;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Back to bots">
            <ArrowLeftIcon className="size-4" />
          </Link>
          <span className={cn("size-2.5 rounded-full", style.dot)} />
          <h1 className="text-lg font-semibold text-foreground">{bot.name}</h1>
          <Badge variant={style.badge}>{bot.state}</Badge>
          {isRemote && (
            <span className="text-xs text-muted-foreground font-mono">@ {node}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {bot.state === "stopped" && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-0 text-success border-success"
              disabled={acting}
              onClick={() => handleAction("start")}
            >
              <PlayIcon className="size-4" /> Start
            </Button>
          )}
          {bot.state === "running" && (
            <>
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-0" asChild>
                <Link to={`/bot/${encodeURIComponent(name)}/terminal${nodeQuery}`}>
                  <TerminalSquareIcon className="size-4" /> New Session with Terminal
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={acting} onClick={() => handleAction("restart")}>
                <RefreshCwIcon className="size-4" /> Restart
              </Button>
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={acting} onClick={() => handleAction("stop")}>
                <SquareIcon className="size-4" /> Stop
              </Button>
              <TooltipIconButton
                tooltip="Force kill"
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive sm:size-8"
                disabled={acting}
                onClick={() => handleAction("kill")}
              >
                <OctagonXIcon className="size-4" />
              </TooltipIconButton>
            </>
          )}
        </div>
      </div>

      {/* Action error */}
      {actionError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Confirm action */}
      {pendingConfirm && (
        <ConfirmActionBanner
          action={pendingConfirm}
          name={name}
          onConfirm={confirmAction}
          onCancel={dismissConfirm}
          acting={acting}
        />
      )}

      {/* Busy warning */}
      {busyWarning && (
        <BusyWarningBanner
          warning={busyWarning}
          onConfirm={confirmForce}
          onCancel={dismissBusy}
          acting={acting}
        />
      )}

      {/* Overview cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">PORT</div>
          <div className="text-sm font-semibold font-mono text-card-foreground">{bot.port ?? "—"}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">WORKSPACE</div>
          <div className="truncate text-sm font-mono text-card-foreground" title={bot.workspacePath}>
            {bot.workspacePath ?? "—"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">STARTED</div>
          <div className="text-sm text-card-foreground">
            {(() => {
              if (!bot.startedAt) return "—";
              const d = new Date(bot.startedAt);
              return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
            })()}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">MODEL</div>
          <div className="text-sm font-mono text-card-foreground">
            {bot.model ? shortModelName(bot.model) : "—"}
          </div>
        </div>
        <AuthSwitcher
          botName={name}
          currentAuth={bot.auth}
          currentAuthType={bot.authType}
          botState={bot.state}
          node={node}
          onSwitched={refetch}
        />
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">COST TODAY</div>
          <div className="text-sm font-semibold text-card-foreground">
            {bot.costToday != null ? formatCost(bot.costToday) : "—"}
          </div>
        </div>
      </div>

      {/* Tags */}
      {bot.tags && bot.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {bot.tags.map((tag) => (
            <Badge key={tag} variant="outline">{tag}</Badge>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions" className="min-h-11 sm:min-h-0">Sessions</TabsTrigger>
          <TabsTrigger value="schedules" className="min-h-11 sm:min-h-0">Schedules</TabsTrigger>
          <TabsTrigger value="files" className="min-h-11 sm:min-h-0" disabled={isRemote}>Files</TabsTrigger>
          <TabsTrigger value="config" className="min-h-11 sm:min-h-0">Config</TabsTrigger>
          <TabsTrigger value="logs" className="min-h-11 sm:min-h-0" disabled={isRemote}>Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions">
          <SessionList name={name} node={node} botState={bot.state} />
        </TabsContent>
        <TabsContent value="schedules">
          <ScheduleList botName={name} node={node} botState={bot.state} />
        </TabsContent>
        <TabsContent value="files">
          {isRemote ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">Files are not available for remote bots.</p>
            </div>
          ) : (
            <BotFiles name={name} />
          )}
        </TabsContent>
        <TabsContent value="config">
          <div className="flex flex-col gap-4">
            <BotPathEditor key={`${bot.homeDir}-${bot.workspacePath}`} bot={bot} name={name} node={node} onSaved={refetch} />
            <BotConfigEditor key={`cfg-${bot.model}-${bot.sandboxMode}`} bot={bot} name={name} node={node} onSaved={refetch} />
            <BotConfigView bot={bot} />
          </div>
        </TabsContent>
        <TabsContent value="logs">
          {isRemote ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">Logs are not available for remote bots.</p>
            </div>
          ) : (
            <BotLogsView name={name} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

const SAFE_CONFIG_KEYS: (keyof BotInfo)[] = [
  "name", "state", "port", "workspacePath", "homeDir", "startedAt", "stoppedAt",
  "exitCode", "tags", "node", "model", "sandboxMode", "permissionMode",
  "auth", "authType", "costToday",
];

function BotPathEditor({ bot, name, node, onSaved }: { bot: BotInfo; name: string; node?: string; onSaved: () => void }) {
  const { authHeaders } = useAuth();
  const [home, setHome] = useState(bot.homeDir ?? "");
  const [workspace, setWorkspace] = useState(bot.workspacePath ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const changed = home !== (bot.homeDir ?? "") || workspace !== (bot.workspacePath ?? "");

  const homeNorm = home || undefined;
  const showWarning = homeNorm && workspace && !workspace.startsWith(homeNorm + "/") && workspace !== homeNorm;

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { restart: true };
      if (home !== (bot.homeDir ?? "")) body.home = home || undefined;
      if (workspace !== (bot.workspacePath ?? "")) body.workspace = workspace || undefined;
      const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
      const res = await fetch(`/bots/${encodeURIComponent(name)}/config${nodeQuery}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setError(data.error ?? "Failed to update config");
        return;
      }
      onSaved();
    } catch {
      setError("Connection error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bot-home-dir" className="text-xs font-medium text-muted-foreground">HOME DIRECTORY</label>
        <input
          id="bot-home-dir"
          type="text"
          value={home}
          onChange={(e) => setHome(e.target.value)}
          placeholder="~/.mecha/<name>/ (default)"
          className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bot-workspace-cwd" className="text-xs font-medium text-muted-foreground">WORKSPACE (CWD)</label>
        <input
          id="bot-workspace-cwd"
          type="text"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          placeholder="Defaults to HOME"
          className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {showWarning && (
        <p className="text-xs text-warning">Workspace is not under home directory — sandbox guards may not cover all files.</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" disabled={!changed || busy} onClick={handleSave}>
          {busy && <Loader2Icon className="size-4 animate-spin" />}
          Save & Restart
        </Button>
      </div>
    </div>
  );
}

interface ModelOption { id: string; label: string }

function BotConfigEditor({ bot, name, node, onSaved }: { bot: BotInfo; name: string; node?: string; onSaved: () => void }) {
  const { authHeaders } = useAuth();
  const [tags, setTags] = useState((bot.tags ?? []).join(", "));
  const [model, setModel] = useState(bot.model ?? "");
  const [sandbox, setSandbox] = useState(bot.sandboxMode ?? "auto");
  const [perm, setPerm] = useState(bot.permissionMode ?? "default");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: models } = useFetch<ModelOption[]>("/models");

  const origTags = (bot.tags ?? []).join(", ");
  const changed = tags !== origTags || model !== (bot.model ?? "") || sandbox !== (bot.sandboxMode ?? "auto") || perm !== (bot.permissionMode ?? "default");

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (tags !== origTags) body.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (model !== (bot.model ?? "")) body.model = model;
      if (sandbox !== (bot.sandboxMode ?? "auto")) body.sandboxMode = sandbox;
      if (perm !== (bot.permissionMode ?? "default")) body.permissionMode = perm;
      const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
      const res = await fetch(`/bots/${encodeURIComponent(name)}/config${nodeQuery}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setError(data.error ?? "Failed to update config");
        return;
      }
      onSaved();
    } catch {
      setError("Connection error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">TAGS</label>
        <input type="text" value={tags} onChange={(e) => setTags(e.target.value)}
          placeholder="web, backend"
          className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        <p className="text-xs text-muted-foreground">Comma-separated</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">MODEL</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}
          className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="">Default</option>
          {models?.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">SANDBOX</label>
          <select value={sandbox} onChange={(e) => setSandbox(e.target.value)}
            className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="auto">auto</option>
            <option value="off">off</option>
            <option value="require">require</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">PERMISSION MODE</label>
          <select value={perm} onChange={(e) => setPerm(e.target.value)}
            className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="default">default</option>
            <option value="plan">plan</option>
            <option value="full-auto">full-auto</option>
          </select>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" disabled={!changed || busy} onClick={handleSave}>
          {busy && <Loader2Icon className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}

function BotConfigView({ bot }: { bot: BotInfo }) {
  const json = useMemo(() => {
    const safe: Partial<BotInfo> = {};
    for (const key of SAFE_CONFIG_KEYS) {
      if (key in bot) (safe as Record<string, unknown>)[key] = bot[key];
    }
    return JSON.stringify(safe, null, 2);
  }, [bot]);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <pre className="text-xs font-mono text-card-foreground whitespace-pre-wrap">
        {json}
      </pre>
    </div>
  );
}
