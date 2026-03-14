import { useState, useEffect } from "react";
import { botFetch } from "../lib/api";

interface Config {
  name?: string;
  model?: string;
  max_turns?: number;
  permission_mode?: string;
  system?: string;
  auth_type?: string;
  auth_profile?: string;
  schedule?: unknown[];
  webhooks?: { accept?: string[] };
  workspace?: string;
  workspace_writable?: boolean;
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

const inputClass =
  "bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full";

const labelClass = "text-sm text-muted-foreground";

export default function ConfigEditor() {
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemExpanded, setSystemExpanded] = useState(false);
  const [authProfiles, setAuthProfiles] = useState<AuthProfile[]>([]);

  useEffect(() => {
    Promise.all([
      botFetch("/api/config").then((r) => r.json()),
      botFetch("/api/auth/profiles").then((r) => r.ok ? r.json() : null),
    ]).then(([data, auth]) => {
      setConfig(data as Config);
      if (auth) {
        setAuthProfiles((auth as AuthInfo).profiles);
      }
    })
      .catch(() => setMessage({ text: "Failed to load config", type: "error" }))
      .finally(() => setLoading(false));
  }, []);

  function updateDraft(key: string, value: unknown) {
    if (config && value === config[key]) {
      setDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setDraft((prev) => ({ ...prev, [key]: value }));
    }
  }

  function currentVal(key: string): unknown {
    return key in draft ? draft[key] : config?.[key];
  }

  const hasChanges = Object.keys(draft).length > 0;

  async function handleSave() {
    if (!hasChanges) return;
    setSaving(true);
    setMessage(null);
    try {
      const resp = await botFetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error || `HTTP ${resp.status}`);
      }
      await resp.json();
      // Update auth_profile display if auth was changed
      if (draft.auth) {
        setConfig((prev) => prev ? { ...prev, ...draft, auth_profile: draft.auth as string } : prev);
      } else {
        setConfig((prev) => prev ? { ...prev, ...draft } : prev);
      }
      setDraft({});
      setMessage({ text: "Config updated — bot is restarting...", type: "success" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Save failed", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Configuration</h2>
        <div className="bg-card rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Loading...
        </div>
      </section>
    );
  }

  if (!config) {
    return (
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Configuration</h2>
        <div className="bg-card rounded-lg border border-border p-4 text-sm text-destructive">
          {message?.text || "Failed to load configuration"}
        </div>
      </section>
    );
  }

  const authType = config.auth_type;
  const authTypeLabel = authType === "oauth" ? "OAuth" : authType === "api_key" ? "API Key" : "Unknown";

  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-3">Configuration</h2>
      <div className="bg-card rounded-lg border border-border p-4 space-y-4">
        {/* Name (read-only) */}
        <div className="space-y-1">
          <label className={labelClass}>Name</label>
          <div className="text-sm text-foreground font-mono">{config.name ?? "—"}</div>
        </div>

        {/* Model */}
        <div className="space-y-1">
          <label className={labelClass}>Model</label>
          <select
            value={(currentVal("model") as string) ?? "sonnet"}
            onChange={(e) => updateDraft("model", e.target.value)}
            className={inputClass}
          >
            <option value="sonnet">sonnet</option>
            <option value="opus">opus</option>
            <option value="haiku">haiku</option>
          </select>
        </div>

        {/* Max Turns */}
        <div className="space-y-1">
          <label className={labelClass}>Max Turns</label>
          <input
            type="number"
            min={1}
            max={100}
            value={(currentVal("max_turns") as number) ?? 25}
            onChange={(e) => updateDraft("max_turns", Math.max(1, Math.min(100, Number(e.target.value))))}
            className={inputClass}
          />
        </div>

        {/* Permission Mode */}
        <div className="space-y-1">
          <label className={labelClass}>Permission Mode</label>
          <select
            value={(currentVal("permission_mode") as string) ?? "default"}
            onChange={(e) => updateDraft("permission_mode", e.target.value)}
            className={inputClass}
          >
            <option value="default">default</option>
            <option value="acceptEdits">acceptEdits</option>
            <option value="bypassPermissions">bypassPermissions</option>
            <option value="plan">plan</option>
            <option value="dontAsk">dontAsk</option>
          </select>
        </div>

        {/* Auth Profile */}
        {authProfiles.length > 0 && (
          <div className="space-y-1">
            <label className={labelClass}>Auth Profile <span className="text-xs text-muted-foreground/60">({authTypeLabel})</span></label>
            <select
              value={(currentVal("auth") as string) ?? config.auth_profile ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === (config.auth_profile ?? "")) {
                  setDraft((prev) => { const next = { ...prev }; delete next.auth; return next; });
                } else {
                  updateDraft("auth", val);
                }
              }}
              className={inputClass}
            >
              {!config.auth_profile && <option value="">Select profile...</option>}
              {authProfiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.type === "oauth_token" ? "OAuth" : "API Key"})
                </option>
              ))}
            </select>
          </div>
        )}

        {authProfiles.length === 0 && (
          <div className="space-y-1">
            <label className={labelClass}>Auth Profile</label>
            <div className="text-sm text-foreground font-mono">{config.auth_profile ?? "—"} <span className="text-muted-foreground font-sans text-xs">({authTypeLabel})</span></div>
          </div>
        )}

        {/* System Prompt */}
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setSystemExpanded(!systemExpanded)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-xs">{systemExpanded ? "v" : ">"}</span>
            System Prompt
          </button>
          {systemExpanded && (
            <textarea
              rows={6}
              value={(currentVal("system") as string) ?? ""}
              onChange={(e) => updateDraft("system", e.target.value)}
              className={`${inputClass} resize-y font-mono`}
            />
          )}
        </div>

        {/* Save button */}
        <div className="pt-2 border-t border-border">
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save & Restart"}
          </button>
        </div>

        {/* Status message */}
        {message && (
          <div
            className={`text-sm px-3 py-2 rounded-md ${
              message.type === "success"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
    </section>
  );
}
