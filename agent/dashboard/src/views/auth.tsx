import { useState, useEffect, useCallback } from "react";
import { fleetFetch } from "../lib/fleet-context";
import { Button, Input, Card, Alert, StatusDot, StatusBadge } from "../components";

interface AuthProfile {
  name: string;
  type: string;
}

function TotpSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const checkStatus = useCallback(() => {
    fleetFetch("/api/totp/status")
      .then((r) => r.json())
      .then((data: { enabled?: boolean }) => setEnabled(!!data.enabled))
      .catch(() => {});
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  async function handleEnable() {
    setBusy(true);
    setMessage(null);
    try {
      const resp = await fleetFetch("/api/totp/enable", { method: "POST" });
      const data = await resp.json() as { secret?: string; uri?: string; error?: string };
      if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Failed"), type: "error" });
        return;
      }
      setSecret(data.secret ?? null);
      setUri(data.uri ?? null);
      setEnabled(true);
      setMessage({ text: "TOTP enabled — save this secret in your authenticator app", type: "success" });
    } catch {
      setMessage({ text: "Network error", type: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (disableCode.length !== 6) return;
    setBusy(true);
    setMessage(null);
    try {
      const resp = await fleetFetch("/api/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode }),
      });
      const data = await resp.json() as { error?: string };
      if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Failed"), type: "error" });
        return;
      }
      setEnabled(false);
      setSecret(null);
      setUri(null);
      setDisableCode("");
      setMessage({ text: "TOTP disabled", type: "success" });
    } catch {
      setMessage({ text: "Network error", type: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Dashboard Authentication</h2>
        <StatusBadge variant={enabled ? "success" : "muted"}>
          {enabled ? "TOTP enabled" : "No authentication"}
        </StatusBadge>
      </div>

      {message && (
        <Alert variant={message.type} onDismiss={() => setMessage(null)} className="mb-3">
          {message.text}
        </Alert>
      )}

      {!enabled && (
        <Card spacing={3}>
          <p className="text-sm text-muted-foreground">
            Enable TOTP to require a 6-digit code from an authenticator app when accessing the dashboard.
          </p>
          <Button onClick={handleEnable} disabled={busy}>
            {busy ? "Enabling..." : "Enable TOTP"}
          </Button>
        </Card>
      )}

      {enabled && secret && (
        <Card spacing={3}>
          <p className="text-sm text-muted-foreground">
            Scan this URI with your authenticator app, or copy the secret manually.
          </p>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Secret</label>
            <Input mono readOnly value={secret} className="w-full" />
          </div>
          {uri && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">OTPAuth URI</label>
              <Input mono readOnly value={uri} className="w-full text-xs" />
            </div>
          )}
        </Card>
      )}

      {enabled && !secret && (
        <Card spacing={3}>
          <p className="text-sm text-muted-foreground">
            To disable TOTP, enter a valid code from your authenticator app.
          </p>
          <Input
            mono
            value={disableCode}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setDisableCode(v);
            }}
            placeholder="6-digit code"
            className="w-48"
            inputMode="numeric"
          />
          <Button
            variant="destructive-soft"
            onClick={handleDisable}
            disabled={disableCode.length !== 6 || busy}
          >
            {busy ? "Disabling..." : "Disable TOTP"}
          </Button>
        </Card>
      )}
    </section>
  );
}

export default function Auth() {
  const [profiles, setProfiles] = useState<AuthProfile[]>([]);
  const [newProfile, setNewProfile] = useState("");
  const [newKey, setNewKey] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const refresh = useCallback(() => {
    fleetFetch("/api/auth")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        if (!Array.isArray(data)) return;
        if (data.length === 0 || typeof data[0] === "string") {
          setProfiles(data.map((name: string) => ({ name, type: "unknown" })));
        } else {
          setProfiles(data as AuthProfile[]);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function addProfile() {
    if (!newProfile || !newKey) return;
    setAddBusy(true);
    setMessage(null);
    try {
      const resp = await fleetFetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: newProfile, key: newKey }),
      });
      const data = await resp.json() as Record<string, unknown>;
      if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Failed to add"), type: "error" });
        return;
      }
      setMessage({ text: `Profile "${newProfile}" added`, type: "success" });
      setNewProfile("");
      setNewKey("");
      refresh();
    } catch { setMessage({ text: "Network error", type: "error" }); }
    finally { setAddBusy(false); }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <TotpSection />

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Auth Profiles</h2>
        <div className="space-y-2">
          {profiles.length === 0 && <p className="text-muted-foreground text-sm">No profiles configured</p>}
          {profiles.map((p) => (
            <Card compact key={p.name} className="flex items-center gap-3">
              <StatusDot color="green" />
              <span className="font-mono text-sm text-foreground">{p.name}</span>
              {p.type !== "unknown" && (
                <span className="text-xs text-muted-foreground">({p.type})</span>
              )}
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Add Profile</h2>
        <Card spacing={3}>
          <Input
            value={newProfile}
            onChange={(e) => setNewProfile(e.target.value)}
            placeholder="Profile name (e.g. anthropic-main)"
            className="w-full"
          />
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="API key or OAuth token"
            type="password"
            className="w-full"
          />

          {message && (
            <Alert variant={message.type}>
              {message.text}
            </Alert>
          )}

          <Button
            onClick={addProfile}
            disabled={!newProfile || !newKey || addBusy}
          >
            {addBusy ? "Adding..." : "Add Profile"}
          </Button>
        </Card>
      </section>
    </div>
  );
}
