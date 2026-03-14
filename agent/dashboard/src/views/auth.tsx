import { useState, useEffect, useCallback } from "react";
import { fleetFetch } from "../lib/fleet-context";
import { Button, Input, Card, Alert, StatusDot } from "../components";

interface AuthProfile {
  name: string;
  type: string;
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
