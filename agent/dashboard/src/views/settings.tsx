import { useState, useEffect, useCallback, useRef } from "react";
import { botFetch } from "../lib/api";
import { Button, Card, Alert, Dialog, DialogFooter, Input } from "../components";
import { useFleet, fleetFetch } from "../lib/fleet-context";
import { getCharacterSprites } from "../pixel-engine/sprites/spriteData";
import { Direction } from "../pixel-engine/types";
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

const AVATAR_PALETTE_COLORS = ['#f4c89a', '#8b6d4a', '#e8a87c', '#c67b5c', '#5c4033', '#2c1810'];

export default function Settings() {
  const [costs, setCosts] = useState<CostData | null>(null);
  const [costError, setCostError] = useState(false);

  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [busyDialog, setBusyDialog] = useState<{
    action: "stop" | "restart";
    state: string;
  } | null>(null);

  const { isFleet, selectedBot } = useFleet();
  const [avatarPalette, setAvatarPalette] = useState(0);
  const [avatarHueShift, setAvatarHueShift] = useState(0);
  const [avatarDisplayName, setAvatarDisplayName] = useState("");
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [avatarSaveError, setAvatarSaveError] = useState(false);
  const avatarSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarCanvasRef = useRef<HTMLCanvasElement>(null);

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

  // ── Avatar: load from server ──────────────────────────────────
  useEffect(() => {
    if (!isFleet || !selectedBot) return;
    // Reset state for new bot and flush pending save from previous bot
    if (avatarSaveTimerRef.current) {
      clearTimeout(avatarSaveTimerRef.current);
      avatarSaveTimerRef.current = null;
    }
    setAvatarLoaded(false);
    setAvatarPalette(0);
    setAvatarHueShift(0);
    setAvatarDisplayName(selectedBot);

    let cancelled = false;
    fleetFetch("/api/office/avatars")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        const avatars = data as Record<string, { palette?: number; hueShift?: number; displayName?: string }>;
        const entry = avatars[selectedBot];
        if (entry) {
          setAvatarPalette(entry.palette ?? 0);
          setAvatarHueShift(entry.hueShift ?? 0);
          setAvatarDisplayName(entry.displayName ?? selectedBot);
        }
        setAvatarLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAvatarLoaded(true);
      });
    return () => { cancelled = true; };
  }, [isFleet, selectedBot]);

  // ── Avatar: debounced save ────────────────────────────────────
  const saveAvatar = useCallback((palette: number, hueShift: number, displayName: string) => {
    if (!selectedBot) return;
    setAvatarSaveError(false);
    if (avatarSaveTimerRef.current) clearTimeout(avatarSaveTimerRef.current);
    avatarSaveTimerRef.current = setTimeout(async () => {
      try {
        const resp = await fleetFetch("/api/office/avatars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: selectedBot, palette, hueShift, displayName: displayName.trim() }),
        });
        if (!resp.ok) setAvatarSaveError(true);
      } catch {
        setAvatarSaveError(true);
      }
    }, 500);
  }, [selectedBot]);

  // ── Avatar: canvas rendering ──────────────────────────────────
  useEffect(() => {
    const canvas = avatarCanvasRef.current;
    if (!canvas) return;
    const sprites = getCharacterSprites(avatarPalette, avatarHueShift);
    const sprite = sprites.typing[Direction.DOWN][0];
    if (!sprite || sprite.length === 0) return;
    const h = sprite.length;
    const w = sprite[0].length;
    const scale = 4;
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = sprite[y][x];
        if (color && color !== "") {
          ctx.fillStyle = color;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
  }, [avatarPalette, avatarHueShift, avatarLoaded]);

  // ── Avatar: cleanup timer on unmount ──────────────────────────
  useEffect(() => {
    return () => {
      if (avatarSaveTimerRef.current) clearTimeout(avatarSaveTimerRef.current);
    };
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

      {/* Avatar */}
      {isFleet && avatarLoaded && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Avatar</h2>
          <Card spacing={3}>
            <div className="flex items-start gap-4">
              <canvas
                ref={avatarCanvasRef}
                style={{ imageRendering: 'pixelated', background: 'var(--color-muted)', borderRadius: 8 }}
                className="shrink-0"
              />
              <div className="flex-1 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Display Name</label>
                  <Input
                    value={avatarDisplayName}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAvatarDisplayName(v);
                      saveAvatar(avatarPalette, avatarHueShift, v);
                    }}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Skin Tone</label>
                  <div className="flex gap-2">
                    {AVATAR_PALETTE_COLORS.map((color, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setAvatarPalette(i);
                          saveAvatar(i, avatarHueShift, avatarDisplayName);
                        }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: color,
                          border: i === avatarPalette ? '2px solid var(--color-primary)' : '2px solid transparent',
                          cursor: 'pointer',
                        }}
                        aria-label={`Palette ${i + 1}`}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Hue Shift <span className="font-mono">{avatarHueShift}°</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={avatarHueShift}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setAvatarHueShift(v);
                      saveAvatar(avatarPalette, v, avatarDisplayName);
                    }}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </Card>
          {avatarSaveError && <Alert variant="error" className="mt-2">Failed to save avatar</Alert>}
        </section>
      )}

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
