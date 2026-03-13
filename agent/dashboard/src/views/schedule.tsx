import { useState, useEffect, useCallback, useRef } from "react";
import { botFetch } from "../lib/api";

interface ScheduleEntry {
  id: string;
  cron: string;
  prompt: string;
  status: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  runCount: number;
  runsToday: number;
  consecutiveErrors: number;
}

const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: "Every minute", cron: "* * * * *" },
  { label: "Every 5 minutes", cron: "*/5 * * * *" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Daily at midnight", cron: "0 0 * * *" },
  { label: "Daily at 9am", cron: "0 9 * * *" },
  { label: "Weekdays at 9am", cron: "0 9 * * 1-5" },
  { label: "Weekly (Monday)", cron: "0 0 * * 1" },
];

function cronToHuman(cron: string): string {
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every minute";
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return `Every ${min.slice(2)} minutes`;
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*")
    return `Every ${hour.slice(2)} hours`;
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every hour";
  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "*") return "Daily at midnight";
  if (dom === "*" && mon === "*" && dow === "*" && /^\d+$/.test(min) && /^\d+$/.test(hour))
    return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "1-5" && /^\d+$/.test(min) && /^\d+$/.test(hour))
    return `Weekdays at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && /^\d+$/.test(dow) && /^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${days[parseInt(dow)] ?? `Day ${dow}`} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return cron;
}

function timeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff < 0) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) {
    const h = Math.floor(diff / 3600_000);
    const m = Math.floor((diff % 3600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(diff / 86400_000)}d`;
}

export default function Schedule() {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Form state
  const [formCron, setFormCron] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const refresh = useCallback(() => {
    botFetch("/api/schedule")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => { setEntries(data as ScheduleEntry[]); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load schedule"));
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 10_000);
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  // Countdown ticker
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  function resetForm() {
    setFormCron("");
    setFormPrompt("");
    setFormError(null);
    setShowAdd(false);
    setEditingId(null);
  }

  async function handleAdd() {
    if (!formCron.trim() || !formPrompt.trim()) { setFormError("Cron and prompt are required"); return; }
    setFormBusy(true);
    setFormError(null);
    try {
      const resp = await botFetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cron: formCron.trim(), prompt: formPrompt.trim() }),
      });
      const data = await resp.json() as Record<string, unknown>;
      if (!resp.ok) { setFormError(String(data.error ?? "Failed to create")); return; }
      resetForm();
      refresh();
    } catch { setFormError("Network error"); }
    finally { setFormBusy(false); }
  }

  async function handleUpdate(id: string) {
    if (!formCron.trim() || !formPrompt.trim()) { setFormError("Cron and prompt are required"); return; }
    setFormBusy(true);
    setFormError(null);
    try {
      const resp = await botFetch(`/api/schedule/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cron: formCron.trim(), prompt: formPrompt.trim() }),
      });
      const data = await resp.json() as Record<string, unknown>;
      if (!resp.ok) { setFormError(String(data.error ?? "Failed to update")); return; }
      resetForm();
      refresh();
    } catch { setFormError("Network error"); }
    finally { setFormBusy(false); }
  }

  async function handleDelete(id: string) {
    try {
      const resp = await botFetch(`/api/schedule/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!resp.ok) {
        const data = await resp.json() as Record<string, unknown>;
        setError(String(data.error ?? "Delete failed"));
        return;
      }
      setDeleteConfirm(null);
      refresh();
    } catch { setError("Network error"); }
  }

  async function handleToggle(entry: ScheduleEntry) {
    const action = entry.status === "active" ? "pause" : "resume";
    try {
      const resp = await botFetch(`/api/schedule/${encodeURIComponent(entry.id)}/${action}`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json() as Record<string, unknown>;
        setError(String(data.error ?? `${action} failed`));
        return;
      }
      refresh();
    } catch { setError("Network error"); }
  }

  async function handleTrigger(id: string) {
    try {
      const resp = await botFetch(`/api/schedule/trigger/${encodeURIComponent(id)}`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json() as Record<string, unknown>;
        setError(String(data.error ?? "Trigger failed"));
        return;
      }
      refresh();
    } catch { setError("Network error"); }
  }

  function startEdit(entry: ScheduleEntry) {
    setEditingId(entry.id);
    setFormCron(entry.cron);
    setFormPrompt(entry.prompt);
    setFormError(null);
    setShowAdd(false);
  }

  function startAdd() {
    setShowAdd(true);
    setEditingId(null);
    setFormCron("");
    setFormPrompt("");
    setFormError(null);
  }

  const isEditing = editingId !== null;

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-foreground">Schedule</h2>
        <button
          onClick={startAdd}
          disabled={showAdd}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          + Add Task
        </button>
      </div>

      {error && (
        <div className="text-sm px-3 py-2 rounded-md bg-destructive/10 text-destructive">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Add / Edit form */}
      {(showAdd || isEditing) && (
        <div className="bg-card rounded-lg border border-border p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">
            {isEditing ? "Edit Schedule Entry" : "New Schedule Entry"}
          </h3>

          {/* Cron presets */}
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.cron}
                onClick={() => setFormCron(p.cron)}
                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                  formCron === p.cron
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Cron Expression (5 fields)</label>
            <input
              value={formCron}
              onChange={(e) => setFormCron(e.target.value)}
              placeholder="*/15 * * * *"
              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {formCron && (
              <div className="text-xs text-muted-foreground mt-1">{cronToHuman(formCron)}</div>
            )}
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Prompt</label>
            <textarea
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
              placeholder="What should the bot do on this schedule?"
              rows={3}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
            />
          </div>

          {formError && (
            <div className="text-sm px-3 py-2 rounded-md bg-destructive/10 text-destructive">{formError}</div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={resetForm}
              className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => isEditing ? handleUpdate(editingId!) : handleAdd()}
              disabled={formBusy || !formCron.trim() || !formPrompt.trim()}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {formBusy ? "Saving..." : isEditing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Entry list */}
      {entries.length === 0 && !showAdd && (
        <p className="text-muted-foreground text-sm">No scheduled tasks. Click "Add Task" to create one.</p>
      )}

      {entries.map((e) => (
        <div key={e.id} className="bg-card rounded-lg border border-border p-4">
          {/* Header row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <code className="text-primary text-sm">{e.cron}</code>
              <span className="text-xs text-muted-foreground">{cronToHuman(e.cron)}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                  e.status === "active"
                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                    : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                }`}
              >
                {e.status}
              </span>
              {e.consecutiveErrors >= 5 && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-destructive/10 text-destructive font-medium">
                  auto-paused
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleToggle(e)}
                className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                title={e.status === "active" ? "Pause" : "Resume"}
              >
                {e.status === "active" ? "Pause" : "Resume"}
              </button>
              <button
                onClick={() => handleTrigger(e.id)}
                className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                title="Run now"
              >
                Trigger
              </button>
              <button
                onClick={() => startEdit(e)}
                className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                title="Edit"
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteConfirm(e.id)}
                className="text-xs px-2 py-1 rounded-md border border-destructive/30 text-destructive/70 hover:text-destructive hover:border-destructive transition-colors"
                title="Delete"
              >
                Delete
              </button>
            </div>
          </div>

          {/* Prompt */}
          <p className="text-sm text-foreground mb-2 whitespace-pre-wrap break-words">
            {e.prompt.length > 200 ? e.prompt.slice(0, 200) + "..." : e.prompt}
          </p>

          {/* Stats row */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {e.nextRunAt && e.status === "active" && (
              <span>Next: <span className="text-foreground">{timeUntil(e.nextRunAt)}</span></span>
            )}
            {e.lastRunAt && (
              <span>Last: {new Date(e.lastRunAt).toLocaleString()}</span>
            )}
            <span>Runs: {e.runCount} (today: {e.runsToday})</span>
            {e.lastResult && (
              <span className={e.lastResult === "error" ? "text-destructive" : e.lastResult === "success" ? "text-green-600 dark:text-green-400" : ""}>
                Last result: {e.lastResult}
              </span>
            )}
            {e.consecutiveErrors > 0 && (
              <span className="text-destructive">Consecutive errors: {e.consecutiveErrors}</span>
            )}
          </div>
        </div>
      ))}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Schedule Entry</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will permanently remove this scheduled task. Are you sure?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
