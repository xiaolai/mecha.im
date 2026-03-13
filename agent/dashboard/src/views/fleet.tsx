import { useState } from "react";
import { useFleet, fleetFetch } from "../lib/fleet-context";

export default function Fleet() {
  const { bots, refreshBots, selectBot } = useFleet();
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawnName, setSpawnName] = useState("");
  const [spawnSystem, setSpawnSystem] = useState("");
  const [spawnModel, setSpawnModel] = useState("sonnet");
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ name: string; action: "stop" | "remove" } | null>(null);

  async function spawn() {
    if (!spawnName || !spawnSystem) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const resp = await fleetFetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: spawnName, system: spawnSystem, model: spawnModel }),
      });
      const data = await resp.json() as Record<string, unknown>;
      if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Spawn failed"), type: "error" });
        return;
      }
      setMessage({ text: `Bot "${spawnName}" spawned`, type: "success" });
      setShowSpawn(false);
      setSpawnName("");
      setSpawnSystem("");
      refreshBots();
    } catch { setMessage({ text: "Network error", type: "error" }); }
    finally { setActionBusy(false); }
  }

  async function stopBot(name: string, force = false) {
    setActionBusy(true);
    setMessage(null);
    try {
      const resp = await fleetFetch(`/api/bots/${name}/stop${force ? "?force=true" : ""}`, { method: "POST" });
      const data = await resp.json() as Record<string, unknown>;
      if (resp.status === 409) {
        setMessage({ text: `Bot is ${data.state ?? "busy"} — use force stop`, type: "error" });
      } else if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Stop failed"), type: "error" });
      } else {
        setMessage({ text: `Bot "${name}" stopping`, type: "success" });
        setConfirmAction(null);
      }
      refreshBots();
    } catch { setMessage({ text: "Network error", type: "error" }); }
    finally { setActionBusy(false); }
  }

  async function restartBot(name: string, force = false) {
    setActionBusy(true);
    setMessage(null);
    try {
      const resp = await fleetFetch(`/api/bots/${name}/restart${force ? "?force=true" : ""}`, { method: "POST" });
      const data = await resp.json() as Record<string, unknown>;
      if (resp.status === 409 && !force) {
        setMessage({ text: `Bot is ${data.state ?? "busy"} — retrying with force`, type: "error" });
        setActionBusy(false);
        return restartBot(name, true);
      } else if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Restart failed"), type: "error" });
      } else {
        setMessage({ text: `Bot "${name}" restarting`, type: "success" });
      }
      refreshBots();
    } catch { setMessage({ text: "Network error", type: "error" }); }
    finally { setActionBusy(false); }
  }

  async function removeBot(name: string) {
    setActionBusy(true);
    setMessage(null);
    try {
      const resp = await fleetFetch(`/api/bots/${name}`, { method: "DELETE" });
      const data = await resp.json() as Record<string, unknown>;
      if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Remove failed"), type: "error" });
      } else {
        setMessage({ text: `Bot "${name}" removed`, type: "success" });
        setConfirmAction(null);
      }
      refreshBots();
    } catch { setMessage({ text: "Network error", type: "error" }); }
    finally { setActionBusy(false); }
  }

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Fleet ({bots.length} bots)</h2>
        <button
          onClick={() => setShowSpawn(!showSpawn)}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          + Spawn Bot
        </button>
      </div>

      {message && (
        <div className={`text-sm px-3 py-2 rounded-md ${
          message.type === "success"
            ? "bg-green-500/10 text-green-600 dark:text-green-400"
            : "bg-destructive/10 text-destructive"
        }`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Spawn form */}
      {showSpawn && (
        <div className="bg-card rounded-lg border border-border p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">New Bot</h3>
          <input
            value={spawnName}
            onChange={(e) => setSpawnName(e.target.value)}
            placeholder="Bot name"
            className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <textarea
            value={spawnSystem}
            onChange={(e) => setSpawnSystem(e.target.value)}
            placeholder="System prompt"
            rows={3}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
          />
          <div className="flex items-center gap-3">
            <select
              value={spawnModel}
              onChange={(e) => setSpawnModel(e.target.value)}
              className="bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
            <div className="flex-1" />
            <button
              onClick={() => setShowSpawn(false)}
              className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={spawn}
              disabled={!spawnName || !spawnSystem || actionBusy}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {actionBusy ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Bot list */}
      {bots.length === 0 && <p className="text-muted-foreground text-sm">No bots. Spawn one to get started.</p>}

      <div className="space-y-2">
        {bots.map((bot) => (
          <div
            key={bot.name}
            className="bg-card rounded-lg border border-border p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  bot.status === "running" ? "bg-green-500" : "bg-muted-foreground"
                }`}
              />
              <div className="min-w-0">
                <button
                  onClick={() => selectBot(bot.name)}
                  className="font-medium text-foreground hover:text-primary transition-colors text-left"
                >
                  {bot.name}
                </button>
                <div className="text-xs text-muted-foreground truncate">
                  {bot.model} | {bot.containerId}{bot.ports ? ` | ${bot.ports}` : ""}
                </div>
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {bot.status === "running" ? (
                <>
                  <button
                    onClick={() => selectBot(bot.name)}
                    className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => restartBot(bot.name)}
                    disabled={actionBusy}
                    className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
                  >
                    Restart
                  </button>
                  <button
                    onClick={() => setConfirmAction({ name: bot.name, action: "stop" })}
                    disabled={actionBusy}
                    className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
                  >
                    Stop
                  </button>
                </>
              ) : (
                <button
                  onClick={() => restartBot(bot.name)}
                  disabled={actionBusy}
                  className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
                >
                  Start
                </button>
              )}
              <button
                onClick={() => setConfirmAction({ name: bot.name, action: "remove" })}
                disabled={actionBusy}
                className="text-xs px-2 py-1 rounded-md border border-destructive/30 text-destructive/70 hover:text-destructive hover:border-destructive transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {confirmAction.action === "stop" ? "Stop Bot" : "Remove Bot"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {confirmAction.action === "stop"
                ? `Stop "${confirmAction.name}"? This will interrupt any running tasks.`
                : `Remove "${confirmAction.name}"? This will delete the container and all its data.`}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmAction.action === "stop") stopBot(confirmAction.name, true);
                  else removeBot(confirmAction.name);
                }}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
              >
                {confirmAction.action === "stop" ? "Force Stop" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
