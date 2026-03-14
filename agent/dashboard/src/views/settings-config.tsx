import { useState, useEffect } from "react";
import { botFetch } from "../lib/api";
import { Button, Input, Select, Textarea, Card, Alert } from "../components";

interface Config {
  name?: string;
  model?: string;
  max_turns?: number;
  permission_mode?: string;
  system?: string;
  auth_type?: string;
  auth_profile?: string;
  schedule?: number;
  webhooks?: { accept?: string[] };
  workspace?: boolean;
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

export default function ConfigEditor() {
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemExpanded, setSystemExpanded] = useState(false);
  const [authProfiles, setAuthProfiles] = useState<AuthProfile[]>([]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const configResp = await botFetch("/api/config");
        if (!configResp.ok) throw new Error(`HTTP ${configResp.status}`);
        setConfig(await configResp.json() as Config);
      } catch {
        setMessage({ text: "Failed to load config", type: "error" });
        setLoading(false);
        return;
      }
      try {
        const authResp = await botFetch("/api/auth/profiles");
        if (authResp.ok) {
          setAuthProfiles((await authResp.json() as AuthInfo).profiles);
        }
      } catch { /* auth profiles are optional */ }
      setLoading(false);
    };
    loadConfig();
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
        <Card className="text-sm text-muted-foreground">
          Loading...
        </Card>
      </section>
    );
  }

  if (!config) {
    return (
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Configuration</h2>
        <Card className="text-sm text-destructive">
          {message?.text || "Failed to load configuration"}
        </Card>
      </section>
    );
  }

  const authType = config.auth_type;
  const authTypeLabel = authType === "oauth" ? "OAuth" : authType === "api_key" ? "API Key" : "Unknown";

  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-3">Configuration</h2>
      <Card spacing={4}>
        {/* Name (read-only) */}
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Name</label>
          <div className="text-sm text-foreground font-mono">{config.name ?? "—"}</div>
        </div>

        {/* Model */}
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Model</label>
          <Select
            value={(currentVal("model") as string) ?? "sonnet"}
            onChange={(e) => updateDraft("model", e.target.value)}
            className="w-full"
          >
            <option value="sonnet">sonnet</option>
            <option value="opus">opus</option>
            <option value="haiku">haiku</option>
          </Select>
        </div>

        {/* Max Turns */}
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Max Turns</label>
          <Input
            type="number"
            min={1}
            max={100}
            value={(currentVal("max_turns") as number) ?? 25}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              updateDraft("max_turns", Math.max(1, Math.min(100, n)));
            }}
            className="w-full"
          />
        </div>

        {/* Permission Mode */}
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Permission Mode</label>
          <Select
            value={(currentVal("permission_mode") as string) ?? "default"}
            onChange={(e) => updateDraft("permission_mode", e.target.value)}
            className="w-full"
          >
            <option value="default">default</option>
            <option value="acceptEdits">acceptEdits</option>
            <option value="bypassPermissions">bypassPermissions</option>
            <option value="plan">plan</option>
            <option value="dontAsk">dontAsk</option>
          </Select>
        </div>

        {/* Auth Profile */}
        {authProfiles.length > 0 && (
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Auth Profile <span className="text-xs text-muted-foreground/60">({authTypeLabel})</span></label>
            <Select
              value={(currentVal("auth") as string) ?? config.auth_profile ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === (config.auth_profile ?? "")) {
                  setDraft((prev) => { const next = { ...prev }; delete next.auth; return next; });
                } else {
                  updateDraft("auth", val);
                }
              }}
              className="w-full"
            >
              {!config.auth_profile && <option value="">Select profile...</option>}
              {authProfiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.type === "oauth_token" ? "OAuth" : "API Key"})
                </option>
              ))}
            </Select>
          </div>
        )}

        {authProfiles.length === 0 && (
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Auth Profile</label>
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
            <Textarea
              mono
              rows={6}
              value={(currentVal("system") as string) ?? ""}
              onChange={(e) => updateDraft("system", e.target.value)}
              className="w-full"
            />
          )}
        </div>

        {/* Save button */}
        <div className="pt-2 border-t border-border">
          <Button
            size="lg"
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving ? "Saving..." : "Save & Restart"}
          </Button>
        </div>

        {/* Status message */}
        {message && (
          <Alert variant={message.type}>
            {message.text}
          </Alert>
        )}
      </Card>
    </section>
  );
}
