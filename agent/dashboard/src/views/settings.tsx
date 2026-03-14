import { useState, useEffect, useCallback } from "react";
import { botFetch } from "../lib/api";
import StatusCard from "./settings-status";
import ConfigEditor from "./settings-config";
import EventLog from "./settings-logs";

interface CostData {
  task: number;
  today: number;
  lifetime: number;
}

const COST_LABELS: Record<string, string> = {
  task: "Current Task",
  today: "Today",
  lifetime: "Lifetime",
};

export default function Settings() {
  const [costs, setCosts] = useState<CostData | null>(null);

  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [busyDialog, setBusyDialog] = useState<{
    action: "stop" | "restart";
    state: string;
  } | null>(null);

  useEffect(() => {
    botFetch("/api/costs")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((co) => {
        const d = co as Record<string, unknown>;
        if (typeof d.task === "number" && typeof d.today === "number" && typeof d.lifetime === "number") {
          setCosts(d as unknown as CostData);
        }
      })
      .catch(() => setCosts(null));
  }, []);

  const handleBotAction = useCallback(async (action: "stop" | "restart", force = false) => {
    setActionPending(true);
    setMessage(null);
    try {
      const resp = await botFetch(`/api/bot/${action}${force ? "?force=true" : ""}`, { method: "POST" });
      const data = await resp.json() as Record<string, unknown>;
      if (resp.status === 409 && data.code === "BOT_BUSY") {
        setBusyDialog({ action, state: String(data.state ?? "busy") });
      } else if (!resp.ok) {
        setMessage({ text: String(data.error ?? "Action failed"), type: "error" });
      } else {
        setMessage({ text: action === "stop" ? "Bot is stopping..." : "Bot is restarting...", type: "success" });
        setBusyDialog(null);
      }
    } catch {
      setMessage({ text: "Network error", type: "error" });
    } finally {
      setActionPending(false);
    }
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <StatusCard />

      {/* Costs */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Costs</h2>
        {costs ? (
          <div className="grid grid-cols-3 gap-4">
            {(["task", "today", "lifetime"] as const).map((k) => (
              <div key={k} className="bg-card rounded-lg border border-border p-4 text-center">
                <div className="text-2xl font-bold text-foreground">${costs[k].toFixed(4)}</div>
                <div className="text-muted-foreground text-sm mt-1">{COST_LABELS[k]}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border p-4 text-sm text-muted-foreground">Loading...</div>
        )}
      </section>

      {/* Controls */}
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
        {message && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-md ${
            message.type === "success"
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-destructive/10 text-destructive"
          }`}>
            {message.text}
          </div>
        )}
      </section>

      <ConfigEditor />

      <EventLog />

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
                : "Restarting now will interrupt the current task. Are you sure?"}
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
                  const { action } = busyDialog;
                  setBusyDialog(null);
                  handleBotAction(action, true);
                }}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
              >
                Force {busyDialog.action === "stop" ? "Stop" : "Restart"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
