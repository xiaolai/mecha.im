import { useState, useEffect, useCallback } from "react";
import { botFetch } from "../lib/api";
import { Button, Card, Alert, Dialog, DialogFooter } from "../components";
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
  const [costError, setCostError] = useState(false);

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
      .catch(() => setCostError(true));
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
              <Card key={k} className="text-center">
                <div className="text-2xl font-bold text-foreground">${costs[k].toFixed(4)}</div>
                <div className="text-muted-foreground text-sm mt-1">{COST_LABELS[k]}</div>
              </Card>
            ))}
          </div>
        ) : costError ? (
          <Card className="text-sm text-destructive">Failed to load costs</Card>
        ) : (
          <Card className="text-sm text-muted-foreground">Loading...</Card>
        )}
      </section>

      {/* Controls */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Controls</h2>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => handleBotAction("restart")}
            disabled={actionPending}
          >
            {actionPending ? "..." : "Restart Bot"}
          </Button>
          <Button
            variant="destructive-soft"
            size="lg"
            onClick={() => handleBotAction("stop")}
            disabled={actionPending}
          >
            {actionPending ? "..." : "Stop Bot"}
          </Button>
        </div>
        {message && (
          <Alert variant={message.type} className="mt-3">
            {message.text}
          </Alert>
        )}
      </section>

      <ConfigEditor />

      <EventLog />

      {/* Busy Warning Dialog */}
      <Dialog open={!!busyDialog} size="md" title="Bot is Busy">
        {busyDialog && (
          <>
            <p className="text-sm text-muted-foreground mb-1">
              The bot is currently <span className="font-mono text-foreground">{busyDialog.state}</span>.
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {busyDialog.action === "stop"
                ? "Stopping now will interrupt the current task. Are you sure?"
                : "Restarting now will interrupt the current task. Are you sure?"}
            </p>
            <DialogFooter>
              <Button variant="secondary" size="lg" onClick={() => setBusyDialog(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={() => {
                  const { action } = busyDialog;
                  setBusyDialog(null);
                  handleBotAction(action, true);
                }}
              >
                Force {busyDialog.action === "stop" ? "Stop" : "Restart"}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </div>
  );
}
