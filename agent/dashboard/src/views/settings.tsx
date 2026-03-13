import { useState, useEffect, useCallback } from "react";
import { botFetch } from "../lib/api";

interface LogEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

interface AuthProfile {
  name: string;
  type: string;
}

interface AuthInfo {
  current_profile: string | null;
  profiles: AuthProfile[];
}

export default function Settings() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [costs, setCosts] = useState<Record<string, unknown> | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Auth switching state
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [authSwitching, setAuthSwitching] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "warning" } | null>(null);

  // Restart/Stop state
  const [busyDialog, setBusyDialog] = useState<{
    action: "stop" | "restart" | "auth-switch";
    state: string;
    profile?: string;
  } | null>(null);
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    Promise.all([
      botFetch("/api/config").then((r) => r.json()),
      botFetch("/api/status").then((r) => r.json()),
      botFetch("/api/costs").then((r) => r.json()),
      botFetch("/api/logs?limit=100").then((r) => r.json()),
      botFetch("/api/auth/profiles").then((r) => r.ok ? r.json() : null),
    ]).then(([c, s, co, l, auth]) => {
      setConfig(c);
      setStatus(s);
      setCosts(co);
      setLogs((l as LogEntry[]).reverse());
      if (auth) {
        setAuthInfo(auth as AuthInfo);
        setSelectedProfile((auth as AuthInfo).current_profile ?? "");
      }
    }).catch((err) => console.error("Settings fetch error:", err));
  }, []);

  function refreshLogs() {
    botFetch("/api/logs?limit=100")
      .then((r) => r.json())
      .then((data) => setLogs((data as LogEntry[]).reverse()))
      .catch((err) => console.error("Log refresh error:", err));
  }

  const handleBotAction = useCallback(async (action: "stop" | "restart", force = false) => {
    setActionPending(true);
    setMessage(null);
    try {
      const url = `/api/bot/${action}${force ? "?force=true" : ""}`;
      const resp = await botFetch(url, { method: "POST" });
      const data = await resp.json() as Record<string, unknown>;
      if (resp.status === 409 && data.code === "BOT_BUSY") {
        setBusyDialog({ action, state: String(data.state ?? "busy") });
      } else if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Action failed"), type: "error" });
      } else {
        setMessage({
          text: action === "stop" ? "Bot is stopping..." : "Bot is restarting...",
          type: "success",
        });
        setBusyDialog(null);
      }
    } catch {
      setMessage({ text: "Network error", type: "error" });
    } finally {
      setActionPending(false);
    }
  }, []);

  const handleAuthSwitch = useCallback(async (force = false) => {
    if (!selectedProfile) return;
    setAuthSwitching(true);
    setMessage(null);
    try {
      const url = `/api/auth/switch${force ? "?force=true" : ""}`;
      const resp = await botFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: selectedProfile }),
      });
      const data = await resp.json() as Record<string, unknown>;
      if (resp.status === 409 && data.code === "BOT_BUSY") {
        setBusyDialog({ action: "auth-switch", state: String(data.state ?? "busy"), profile: selectedProfile });
      } else if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Switch failed"), type: "error" });
      } else {
        setMessage({ text: `Switching to "${selectedProfile}" — bot is restarting...`, type: "success" });
        setBusyDialog(null);
      }
    } catch {
      setMessage({ text: "Network error", type: "error" });
    } finally {
      setAuthSwitching(false);
    }
  }, [selectedProfile]);

  const authTypeLabel = config?.auth_type === "oauth" ? "OAuth Token" : config?.auth_type === "api_key" ? "API Key" : "Unknown";

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto h-full overflow-y-auto">
      {/* Status */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Status</h2>
        {status && (
          <div className="bg-card rounded-lg border border-border p-4 font-mono text-sm text-foreground">
            <pre>{JSON.stringify(status, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Auth & Controls */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Authentication</h2>
        <div className="bg-card rounded-lg border border-border p-4 space-y-4">
          {/* Current auth info */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Current:</span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              config?.auth_type === "oauth"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : config?.auth_type === "api_key"
                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                  : "bg-muted text-muted-foreground"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                config?.auth_type === "oauth" ? "bg-green-500" : config?.auth_type === "api_key" ? "bg-blue-500" : "bg-muted-foreground"
              }`} />
              {authTypeLabel}
            </span>
            {config?.auth_profile ? (
              <span className="text-sm text-muted-foreground">
                profile: <span className="text-foreground font-mono">{String(config.auth_profile)}</span>
              </span>
            ) : null}
          </div>

          {/* Auth switcher */}
          {authInfo && authInfo.profiles.length > 0 && (
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <label className="text-sm text-muted-foreground shrink-0">Switch to:</label>
              <select
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value)}
                className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select profile...</option>
                {authInfo.profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.type === "oauth_token" ? "OAuth" : "API Key"})
                  </option>
                ))}
              </select>
              <button
                onClick={() => handleAuthSwitch()}
                disabled={!selectedProfile || authSwitching || selectedProfile === (config?.auth_profile ?? "")}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {authSwitching ? "Switching..." : "Switch & Restart"}
              </button>
            </div>
          )}

          {authInfo && authInfo.profiles.length === 0 && (
            <p className="text-sm text-muted-foreground pt-2 border-t border-border">
              No auth profiles available. Use <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">mecha auth add</code> to add credentials.
            </p>
          )}

          {/* Status message */}
          {message && (
            <div className={`text-sm px-3 py-2 rounded-md ${
              message.type === "success"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : message.type === "warning"
                  ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                  : "bg-destructive/10 text-destructive"
            }`}>
              {message.text}
            </div>
          )}
        </div>
      </section>

      {/* Bot Controls */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Controls</h2>
        <div className="flex gap-3">
          <button
            onClick={() => handleBotAction("restart")}
            disabled={actionPending}
            className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50 transition-colors"
          >
            {actionPending ? "..." : "Restart Bot"}
          </button>
          <button
            onClick={() => handleBotAction("stop")}
            disabled={actionPending}
            className="px-4 py-2 text-sm bg-destructive/10 text-destructive rounded-md hover:bg-destructive/20 disabled:opacity-50 transition-colors"
          >
            {actionPending ? "..." : "Stop Bot"}
          </button>
        </div>
      </section>

      {/* Busy Warning Dialog */}
      {busyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-foreground mb-2">Bot is Busy</h3>
            <p className="text-sm text-muted-foreground mb-1">
              The bot is currently <span className="font-mono text-foreground">{busyDialog.state}</span>.
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {busyDialog.action === "stop"
                ? "Stopping now will interrupt the current task. Are you sure?"
                : busyDialog.action === "restart"
                  ? "Restarting now will interrupt the current task. Are you sure?"
                  : `Switching auth to "${busyDialog.profile}" requires a restart, which will interrupt the current task.`}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setBusyDialog(null)}
                className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { action, profile } = busyDialog;
                  setBusyDialog(null);
                  if (action === "auth-switch" && profile) {
                    setSelectedProfile(profile);
                    // Need to force — pass through busy check
                    // For auth switch, there's no force param on the bot API, it just checks busy.isLocked
                    // The dialog already confirmed intent, so we proceed
                    handleAuthSwitch(true);
                  } else {
                    handleBotAction(action as "stop" | "restart", true);
                  }
                }}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
              >
                Force {busyDialog.action === "stop" ? "Stop" : busyDialog.action === "restart" ? "Restart" : "Switch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Costs */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Costs</h2>
        {costs && (
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(costs).map(([k, v]) => (
              <div key={k} className="bg-card rounded-lg border border-border p-4 text-center">
                <div className="text-2xl font-bold text-foreground">${typeof v === "number" ? v.toFixed(4) : String(v)}</div>
                <div className="text-muted-foreground text-sm mt-1">{String(k)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Configuration */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Configuration</h2>
        {config && (
          <div className="bg-card rounded-lg border border-border p-4 font-mono text-sm text-foreground">
            <pre>{JSON.stringify(config, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Event Log */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">Event Log</h2>
          <button
            onClick={refreshLogs}
            className="text-sm bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-1 rounded-md transition-colors"
          >
            Refresh
          </button>
        </div>
        <div className="space-y-1 font-mono text-sm max-h-96 overflow-y-auto scrollbar-thin">
          {logs.length === 0 && <p className="text-muted-foreground">No events</p>}
          {logs.map((entry, i) => (
            <div key={`${entry.timestamp}-${entry.type}-${i}`} className="flex gap-3 py-1 border-b border-border/50">
              <span className="text-muted-foreground shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={`shrink-0 ${
                  entry.type === "mecha_call"
                    ? "text-primary"
                    : entry.type === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                {entry.type}
              </span>
              <span className="text-foreground truncate">
                {Object.entries(entry)
                  .filter(([k]) => k !== "type" && k !== "timestamp")
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(" ")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
