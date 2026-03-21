import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth-context";
import type { BotInfo } from "./bot-card";

interface BotPathEditorProps {
  bot: BotInfo;
  name: string;
  node?: string;
  onSaved: () => void;
}

export function BotPathEditor({ bot, name, node, onSaved }: BotPathEditorProps) {
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
      if (home !== (bot.homeDir ?? "")) body.home = home || null;
      if (workspace !== (bot.workspacePath ?? "")) body.workspace = workspace || null;
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
