import { useState } from "react";
import {
  PlusIcon,
  Loader2Icon,
  Trash2Icon,
  ZapIcon,
  CheckCircleIcon,
  XCircleIcon,
  TerminalIcon,
  GlobeIcon,
  RadioIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

interface PluginConfig {
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  description?: string;
  addedAt: string;
}

interface PluginEntry {
  name: string;
  config: PluginConfig;
}

type TestResult = { ok: boolean; status?: number; error?: string; command?: string; note?: string } | null;

const TYPE_OPTIONS = [
  { value: "stdio", label: "stdio" },
  { value: "http", label: "http" },
  { value: "sse", label: "sse" },
] as const;

function typeIcon(type: string) {
  switch (type) {
    case "stdio": return <TerminalIcon className="size-4 text-muted-foreground" />;
    case "http": return <GlobeIcon className="size-4 text-muted-foreground" />;
    case "sse": return <RadioIcon className="size-4 text-muted-foreground" />;
    default: return null;
  }
}

function typeBadgeVariant(type: string): "default" | "secondary" | "outline" {
  switch (type) {
    case "stdio": return "secondary";
    case "http": return "default";
    case "sse": return "outline";
    default: return "secondary";
  }
}

/** Renders installed MCP plugins as cards with add, test, and remove actions. */
export function PluginsView() {
  const { data: plugins, loading, error, refetch } = useFetch<PluginEntry[]>("/plugins");
  const { authHeaders } = useAuth();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"stdio" | "http" | "sse">("http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [removing, setRemoving] = useState<Record<string, boolean>>({});
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const payload: Record<string, unknown> = { name, type, description: description || undefined };
      if (type === "stdio") {
        payload.command = command;
        if (args.trim()) payload.args = args.split(/\s+/);
      } else {
        payload.url = url;
      }
      const res = await fetch("/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setCreateError(body.error ?? "Request failed");
        return;
      }
      resetForm();
      refetch();
    } catch {
      setCreateError("Connection error");
    } finally {
      setCreating(false);
    }
  }

  function resetForm() {
    setName("");
    setType("http");
    setUrl("");
    setCommand("");
    setArgs("");
    setDescription("");
    setShowForm(false);
    setCreateError(null);
  }

  async function handleTest(pluginName: string) {
    setTesting((prev) => ({ ...prev, [pluginName]: true }));
    setTestResults((prev) => ({ ...prev, [pluginName]: null }));
    try {
      const res = await fetch(`/plugins/${encodeURIComponent(pluginName)}/test`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
      });
      const body = await res.json();
      setTestResults((prev) => ({ ...prev, [pluginName]: body }));
    } catch {
      setTestResults((prev) => ({ ...prev, [pluginName]: { ok: false, error: "Connection failed" } }));
    } finally {
      setTesting((prev) => ({ ...prev, [pluginName]: false }));
    }
  }

  async function handleRemove(pluginName: string) {
    setRemoving((prev) => ({ ...prev, [pluginName]: true }));
    setMutationError(null);
    try {
      const res = await fetch(`/plugins/${encodeURIComponent(pluginName)}`, {
        method: "DELETE",
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setMutationError(data.error ?? "Failed to remove plugin");
        return;
      }
      refetch();
    } catch {
      setMutationError("Connection error");
    } finally {
      setRemoving((prev) => ({ ...prev, [pluginName]: false }));
    }
  }

  if (loading && !plugins) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error && !plugins) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load plugins.
      </div>
    );
  }

  const safePlugins = Array.isArray(plugins) ? plugins : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Add plugin button */}
      {!showForm && (
        <div>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <PlusIcon className="size-4" />
            Add Plugin
          </Button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-plugin"
                  className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as "stdio" | "http" | "sse")}
                  className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Conditional fields */}
            {type === "stdio" ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-medium text-muted-foreground">Command</label>
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="node"
                    className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-medium text-muted-foreground">Args (space-separated)</label>
                  <input
                    type="text"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder="server.js --port 3000"
                    className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Description (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this plugin do?"
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {createError && (
            <p className="text-sm text-destructive">{createError}</p>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!name || (type === "stdio" ? !command : !url) || creating}
              onClick={handleCreate}
              className="h-11 sm:h-9"
            >
              {creating ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={resetForm} className="h-11 sm:h-9">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mutationError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{mutationError}</div>
      )}

      {/* Plugin cards */}
      {safePlugins.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No plugins installed.</p>
        </div>
      ) : (
        <>
          {error && (
            <div role="alert" className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
              Failed to refresh — showing last known state.
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {safePlugins.map((plugin) => {
              const result = testResults[plugin.name];
              return (
                <div
                  key={plugin.name}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
                >
                  {/* Header: icon + name + type badge */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {typeIcon(plugin.config.type)}
                      <span className="text-sm font-semibold text-card-foreground truncate font-mono">
                        {plugin.name}
                      </span>
                    </div>
                    <Badge variant={typeBadgeVariant(plugin.config.type)}>
                      {plugin.config.type}
                    </Badge>
                  </div>

                  {/* Details */}
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {plugin.config.description && (
                      <p className="text-sm text-card-foreground">{plugin.config.description}</p>
                    )}
                    {plugin.config.url && (
                      <p className="font-mono truncate">{plugin.config.url}</p>
                    )}
                    {plugin.config.command && (
                      <p className="font-mono truncate">
                        {plugin.config.command}
                        {plugin.config.args?.length ? ` ${plugin.config.args.join(" ")}` : ""}
                      </p>
                    )}
                  </div>

                  {/* Test result */}
                  {result && (
                    <div className="text-xs">
                      {result.ok ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircleIcon className="size-3" />
                          Reachable{result.status ? ` (${result.status})` : ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <XCircleIcon className="size-3" />
                          {result.error ?? "Failed"}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1 pt-1 border-t border-border">
                    <TooltipIconButton
                      tooltip="Test connectivity"
                      variant="ghost"
                      size="icon-sm"
                      disabled={testing[plugin.name]}
                      onClick={() => handleTest(plugin.name)}
                    >
                      {testing[plugin.name] ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <ZapIcon className="size-4" />
                      )}
                    </TooltipIconButton>
                    <TooltipIconButton
                      tooltip="Remove plugin"
                      variant="ghost"
                      size="icon-sm"
                      disabled={removing[plugin.name]}
                      onClick={() => handleRemove(plugin.name)}
                    >
                      {removing[plugin.name] ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <Trash2Icon className="size-4" />
                      )}
                    </TooltipIconButton>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
