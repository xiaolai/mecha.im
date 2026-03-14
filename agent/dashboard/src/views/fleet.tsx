import { useState } from "react";
import { useFleet, fleetFetch } from "../lib/fleet-context";
import { Button, Input, Select, Textarea, Card, Alert, Dialog, DialogFooter, StatusDot } from "../components";

export default function Fleet() {
  const { bots, refreshBots, selectBot } = useFleet();
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawnName, setSpawnName] = useState("");
  const [spawnSystem, setSpawnSystem] = useState("");
  const [spawnModel, setSpawnModel] = useState("sonnet");
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ name: string; action: "stop" | "remove" | "restart" } | null>(null);

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
      if (!resp.ok) {
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
        setConfirmAction({ name, action: "restart" });
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
        <Button onClick={() => setShowSpawn(!showSpawn)}>
          + Spawn Bot
        </Button>
      </div>

      {message && (
        <Alert variant={message.type} onDismiss={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {/* Spawn form */}
      {showSpawn && (
        <Card spacing={3}>
          <h3 className="text-sm font-medium text-foreground">New Bot</h3>
          <Input
            value={spawnName}
            onChange={(e) => setSpawnName(e.target.value)}
            placeholder="Bot name"
            className="w-full"
          />
          <Textarea
            value={spawnSystem}
            onChange={(e) => setSpawnSystem(e.target.value)}
            placeholder="System prompt"
            rows={3}
            className="w-full"
          />
          <div className="flex items-center gap-3">
            <Select
              value={spawnModel}
              onChange={(e) => setSpawnModel(e.target.value)}
            >
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </Select>
            <div className="flex-1" />
            <Button
              variant="secondary"
              onClick={() => setShowSpawn(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={spawn}
              disabled={!spawnName || !spawnSystem || actionBusy}
            >
              {actionBusy ? "Creating..." : "Create"}
            </Button>
          </div>
        </Card>
      )}

      {/* Bot list */}
      {bots.length === 0 && <p className="text-muted-foreground text-sm">No bots. Spawn one to get started.</p>}

      <div className="space-y-2">
        {bots.map((bot) => (
          <Card
            key={bot.name}
            compact
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-3 min-w-0">
              <StatusDot
                color={bot.status === "running" ? "green" : "muted"}
                size="lg"
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
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => selectBot(bot.name)}
                  >
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => restartBot(bot.name)}
                    disabled={actionBusy}
                  >
                    Restart
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setConfirmAction({ name: bot.name, action: "stop" })}
                    disabled={actionBusy}
                  >
                    Stop
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => restartBot(bot.name)}
                  disabled={actionBusy}
                >
                  Start
                </Button>
              )}
              <Button
                variant="ghost-destructive"
                size="xs"
                onClick={() => setConfirmAction({ name: bot.name, action: "remove" })}
                disabled={actionBusy}
              >
                Remove
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Confirm dialog */}
      <Dialog
        open={!!confirmAction}
        title={confirmAction?.action === "remove" ? "Remove Bot" : confirmAction?.action === "restart" ? "Restart Bot" : "Stop Bot"}
        description={
          confirmAction?.action === "remove"
            ? `Remove "${confirmAction.name}"? This will delete the container and all its data.`
            : confirmAction?.action === "restart"
              ? `"${confirmAction.name}" is busy. Force restart will interrupt the current task.`
              : confirmAction
                ? `Stop "${confirmAction.name}"? This will interrupt any running tasks.`
                : undefined
        }
      >
        <DialogFooter>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setConfirmAction(null)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => {
              if (confirmAction?.action === "stop") stopBot(confirmAction.name, true);
              else if (confirmAction?.action === "restart") restartBot(confirmAction.name, true);
              else if (confirmAction) removeBot(confirmAction.name);
            }}
          >
            {confirmAction?.action === "remove" ? "Remove" : confirmAction?.action === "restart" ? "Force Restart" : "Force Stop"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
