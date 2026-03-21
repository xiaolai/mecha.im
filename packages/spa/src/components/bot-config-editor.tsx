import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";
import type { BotInfo } from "./bot-card";

export interface ModelOption { id: string; label: string }

interface BotConfigEditorProps {
  bot: BotInfo;
  name: string;
  node?: string;
  onSaved: () => void;
}

export function BotConfigEditor({ bot, name, node, onSaved }: BotConfigEditorProps) {
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
            <option value="bypassPermissions">bypassPermissions</option>
            <option value="acceptEdits">acceptEdits</option>
            <option value="dontAsk">dontAsk</option>
            <option value="auto">auto</option>
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
