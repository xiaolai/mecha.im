import { useState, useEffect, useCallback } from "react";
import { fleetFetch } from "../lib/fleet-context";

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
      .then((r) => r.json())
      .then((data) => {
        // API returns array of names; enrich if possible
        if (Array.isArray(data) && (data.length === 0 || typeof data[0] === "string")) {
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
            <div
              key={p.name}
              className="bg-card rounded-lg border border-border p-3 flex items-center gap-3"
            >
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="font-mono text-sm text-foreground">{p.name}</span>
              {p.type !== "unknown" && (
                <span className="text-xs text-muted-foreground">({p.type})</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Add Profile</h2>
        <div className="bg-card rounded-lg border border-border p-4 space-y-3">
          <input
            value={newProfile}
            onChange={(e) => setNewProfile(e.target.value)}
            placeholder="Profile name (e.g. anthropic-main)"
            className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="API key or OAuth token"
            type="password"
            className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {message && (
            <div className={`text-sm px-3 py-2 rounded-md ${
              message.type === "success"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-destructive/10 text-destructive"
            }`}>
              {message.text}
            </div>
          )}

          <button
            onClick={addProfile}
            disabled={!newProfile || !newKey || addBusy}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {addBusy ? "Adding..." : "Add Profile"}
          </button>
        </div>
      </section>
    </div>
  );
}
