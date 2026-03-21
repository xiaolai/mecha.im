import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/lib/use-fetch";

interface SandboxProfile {
  name: string;
  sandboxMode: string;
  settings: Record<string, unknown>;
  hooks: string[];
}

/** Displays sandbox mode, hooks, and settings for a selected bot. */
export function SandboxView() {
  const { data: bots, error: botsError } = useFetch<Array<{ name: string; state: string }>>("/bots");
  const [selectedBot, setSelectedBot] = useState<string | null>(null);

  const botName = selectedBot ?? bots?.[0]?.name ?? null;
  const { data: profile, loading, error: profileError } = useFetch<SandboxProfile>(
    botName ? `/bots/${encodeURIComponent(botName)}/sandbox` : null,
    { deps: [botName] },
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Bot selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Select Bot</label>
        <select
          value={botName ?? ""}
          onChange={(e) => setSelectedBot(e.target.value || null)}
          className="h-11 sm:h-9 w-full sm:w-64 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {bots?.map((b) => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
      </div>

      {(botsError || profileError) && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{botsError || profileError}</div>
      )}

      {loading && !profile ? (
        <Skeleton className="h-48 rounded-lg" />
      ) : profile ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground mb-1">SANDBOX MODE</div>
              <Badge variant={profile.sandboxMode === "require" ? "default" : "secondary"}>
                {profile.sandboxMode}
              </Badge>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground mb-1">HOOK SCRIPTS</div>
              {profile.hooks.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {profile.hooks.map((h) => (
                    <Badge key={h} variant="outline" className="font-mono text-xs">{h}</Badge>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">None</span>
              )}
            </div>
          </div>

          {Object.keys(profile.settings).length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground mb-2">SETTINGS</div>
              <pre className="font-mono text-xs text-card-foreground whitespace-pre-wrap">
                {JSON.stringify(profile.settings, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No bots available.</p>
        </div>
      )}
    </div>
  );
}
