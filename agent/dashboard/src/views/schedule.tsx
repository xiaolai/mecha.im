import { useState, useEffect, useCallback, useRef } from "react";
import { botFetch } from "../lib/api";
import type { ScheduleEntry } from "./schedule-types";
import { CRON_PRESETS, cronToHuman, timeUntil } from "./schedule-utils";
import { Alert, Button, Card, Dialog, DialogFooter, Input, StatusBadge, Textarea } from "../components";

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
        <Button onClick={startAdd} disabled={showAdd || isEditing}>
          + Add Task
        </Button>
      </div>

      {error && (
        <Alert variant="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Add / Edit form */}
      {(showAdd || isEditing) && (
        <Card spacing={3}>
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
            <Input
              mono
              value={formCron}
              onChange={(e) => setFormCron(e.target.value)}
              placeholder="*/15 * * * *"
              className="w-full"
            />
            {formCron && (
              <div className="text-xs text-muted-foreground mt-1">{cronToHuman(formCron)}</div>
            )}
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Prompt</label>
            <Textarea
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
              placeholder="What should the bot do on this schedule?"
              rows={3}
              className="w-full"
            />
          </div>

          {formError && (
            <Alert variant="error">{formError}</Alert>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={resetForm}>
              Cancel
            </Button>
            <Button
              onClick={() => isEditing ? handleUpdate(editingId!) : handleAdd()}
              disabled={formBusy || !formCron.trim() || !formPrompt.trim()}
            >
              {formBusy ? "Saving..." : isEditing ? "Update" : "Create"}
            </Button>
          </div>
        </Card>
      )}

      {/* Entry list */}
      {entries.length === 0 && !showAdd && (
        <p className="text-muted-foreground text-sm">No scheduled tasks. Click "Add Task" to create one.</p>
      )}

      {entries.map((e) => (
        <Card key={e.id}>
          {/* Header row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <code className="text-primary text-sm">{e.cron}</code>
              <span className="text-xs text-muted-foreground">{cronToHuman(e.cron)}</span>
              <StatusBadge variant={e.status === "active" ? "success" : "warning"}>
                {e.status}
              </StatusBadge>
              {e.consecutiveErrors >= 5 && (
                <StatusBadge variant="error">
                  auto-paused
                </StatusBadge>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => handleToggle(e)}
                title={e.status === "active" ? "Pause" : "Resume"}
              >
                {e.status === "active" ? "Pause" : "Resume"}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => handleTrigger(e.id)}
                title="Run now"
              >
                Trigger
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => startEdit(e)}
                title="Edit"
              >
                Edit
              </Button>
              <Button
                variant="ghost-destructive"
                size="xs"
                onClick={() => setDeleteConfirm(e.id)}
                title="Delete"
              >
                Delete
              </Button>
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
        </Card>
      ))}

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteConfirm !== null}
        title="Delete Schedule Entry"
        description="This will permanently remove this scheduled task. Are you sure?"
      >
        <DialogFooter>
          <Button variant="secondary" size="lg" onClick={() => setDeleteConfirm(null)}>
            Cancel
          </Button>
          <Button variant="destructive" size="lg" onClick={() => handleDelete(deleteConfirm!)}>
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
