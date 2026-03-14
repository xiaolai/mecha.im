import { useState, useEffect, useCallback, useRef } from "react";
import { botFetch, botUrl } from "../lib/api";
import { Button, Input, Select, Card, Alert, Badge, StatusDot } from "../components";

const GITHUB_PRESETS = [
  { label: "Push", value: "push" },
  { label: "Pull Request Opened", value: "pull_request.opened" },
  { label: "Pull Request Closed", value: "pull_request.closed" },
  { label: "PR Review Requested", value: "pull_request.review_requested" },
  { label: "Issue Opened", value: "issues.opened" },
  { label: "Issue Commented", value: "issue_comment.created" },
  { label: "Release Published", value: "release.published" },
  { label: "Workflow Run Completed", value: "workflow_run.completed" },
  { label: "Star Created", value: "star.created" },
];

export default function Webhooks() {
  const [accept, setAccept] = useState<string[]>([]);
  const [secretSet, setSecretSet] = useState(false);
  const [newEvent, setNewEvent] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [showSecretForm, setShowSecretForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = useCallback((text: string, type: "success" | "error") => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setMessage({ text, type });
    flashTimer.current = setTimeout(() => setMessage(null), 3000);
  }, []);

  const refresh = useCallback(() => {
    botFetch("/api/webhooks")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: any) => {
        setAccept(data.accept ?? []);
        setSecretSet(!!data.secret_set);
        setLoading(false);
      })
      .catch((err) => {
        flash(err instanceof Error ? err.message : "Failed to load", "error");
        setLoading(false);
      });
  }, [flash]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleAddEvent() {
    const ev = newEvent.trim();
    if (!ev) return;
    if (accept.includes(ev)) { flash(`"${ev}" already accepted`, "error"); return; }
    try {
      const resp = await botFetch("/api/webhooks/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: ev }),
      });
      if (!resp.ok) { const d = await resp.json() as any; flash(d.error ?? "Failed to add", "error"); return; }
      setAccept((prev) => [...prev, ev]);
      setNewEvent("");
      flash(`Event "${ev}" added`, "success");
    } catch { flash("Network error", "error"); }
  }

  async function handleRemoveEvent(ev: string) {
    try {
      const resp = await botFetch(`/api/webhooks/accept/${encodeURIComponent(ev)}`, { method: "DELETE" });
      if (!resp.ok) { const d = await resp.json() as any; flash(d.error ?? "Failed to remove", "error"); return; }
      setAccept((prev) => prev.filter((e) => e !== ev));
      flash(`Event "${ev}" removed`, "success");
    } catch { flash("Network error", "error"); }
  }

  async function handleSaveSecret() {
    try {
      const resp = await botFetch("/api/webhooks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: newSecret || null }),
      });
      if (!resp.ok) { const d = await resp.json() as any; flash(d.error ?? "Failed to save", "error"); return; }
      setSecretSet(!!newSecret);
      setNewSecret("");
      setShowSecretForm(false);
      flash(newSecret ? "Secret updated" : "Secret removed", "success");
    } catch { flash("Network error", "error"); }
  }

  async function handleCopyUrl() {
    const url = window.location.origin + botUrl("/webhook");
    try {
      await navigator.clipboard.writeText(url);
      flash("Copied!", "success");
    } catch { flash("Failed to copy", "error"); }
  }

  const availablePresets = GITHUB_PRESETS.filter((p) => !accept.includes(p.value));

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto h-full flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto h-full overflow-y-auto">
      <h2 className="text-lg font-semibold text-foreground mb-2">Webhooks</h2>

      {message && (
        <Alert variant={message.type}>
          {message.text}
        </Alert>
      )}

      <Card spacing={2}>
        <h3 className="text-sm font-medium text-foreground">Endpoint</h3>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono text-primary bg-background border border-border rounded-md px-3 py-1.5">
            POST /webhook
          </code>
          <Button onClick={handleCopyUrl} className="whitespace-nowrap">
            Copy URL
          </Button>
        </div>
      </Card>

      <Card spacing={3}>
        <h3 className="text-sm font-medium text-foreground">Accepted Events</h3>
        {accept.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events configured -- add one to start</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {accept.map((ev) => (
              <Badge key={ev} variant="primary" onRemove={() => handleRemoveEvent(ev)}>
                {ev}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {availablePresets.length > 0 && (
            <Select
              compact
              value=""
              onChange={(e) => { if (e.target.value) setNewEvent(e.target.value); }}
            >
              <option value="">GitHub Events</option>
              {availablePresets.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          )}
          <Input
            value={newEvent}
            onChange={(e) => setNewEvent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddEvent(); }}
            placeholder="custom.event"
            className="flex-1"
          />
          <Button
            onClick={handleAddEvent}
            disabled={!newEvent.trim()}
          >
            + Add
          </Button>
        </div>
      </Card>

      <Card spacing={3}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Secret</h3>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => { setShowSecretForm(!showSecretForm); setNewSecret(""); }}
          >
            {showSecretForm ? "Cancel" : "Change"}
          </Button>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <StatusDot color={secretSet ? "green" : "muted-lighter"} />
          <span className="text-foreground">{secretSet ? "Configured" : "Not set"}</span>
        </div>

        {showSecretForm && (
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              placeholder="Enter new secret"
              className="flex-1"
            />
            <Button
              onClick={handleSaveSecret}
              disabled={!newSecret.trim()}
            >
              Save
            </Button>
            {secretSet && (
              <Button
                variant="ghost-destructive"
                onClick={async () => {
                  try {
                    const resp = await botFetch("/api/webhooks", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ secret: null }),
                    });
                    if (!resp.ok) { flash("Failed to remove secret", "error"); return; }
                    setSecretSet(false);
                    setShowSecretForm(false);
                    flash("Secret removed", "success");
                  } catch { flash("Network error", "error"); }
                }}
              >
                Remove
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
