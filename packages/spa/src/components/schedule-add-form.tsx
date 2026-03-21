import { useId, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth-context";

// Validation rules mirrored from @mecha/core (schedule.ts + validation.ts).
// SPA cannot import @mecha/core directly (Node-only package).
const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const NAME_MAX_LENGTH = 32;
const INTERVAL_RE = /^(\d+)(s|m|h)$/;
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };
const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 86_400_000;

function validateInterval(input: string): string | null {
  const match = INTERVAL_RE.exec(input);
  if (!match) return "Use format: 30s, 5m, 1h";
  const ms = Number(match[1]) * (UNIT_MS[match[2] as string] ?? 0);
  if (ms < MIN_INTERVAL_MS) return "Minimum interval is 10s";
  if (ms > MAX_INTERVAL_MS) return "Maximum interval is 24h";
  return null;
}

function validateId(input: string): string | null {
  if (!input) return "Required";
  if (input.length > NAME_MAX_LENGTH) return `Max ${NAME_MAX_LENGTH} characters`;
  if (!NAME_PATTERN.test(input)) return "Lowercase alphanumeric and hyphens only";
  return null;
}

interface ScheduleAddFormProps {
  botName: string;
  node?: string;
  onAdded: () => void;
  onCancel: () => void;
}

/** Renders a form to create a new schedule with ID, interval, and prompt fields. */
export function ScheduleAddForm({ botName, node, onAdded, onCancel }: ScheduleAddFormProps) {
  const uid = useId();
  const [id, setId] = useState("");
  const [every, setEvery] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState({ id: false, every: false, prompt: false });
  const { authHeaders, logout } = useAuth();

  const idError = touched.id ? validateId(id) : null;
  const everyError = touched.every ? validateInterval(every) : null;
  const promptError = touched.prompt && !prompt.trim() ? "Required" : null;
  const canSubmit = id && every && prompt.trim() && !validateId(id) && !validateInterval(every);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ id: true, every: true, prompt: true });
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
      const res = await fetch(`/bots/${encodeURIComponent(botName)}/schedules${nodeQuery}`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, every, prompt: prompt.trim() }),
      });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setServerError(body.error ?? "Failed to add schedule");
        return;
      }
      onAdded();
    } catch {
      setServerError("Connection error");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const idId = `${uid}-id`;
  const everyId = `${uid}-every`;
  const promptId = `${uid}-prompt`;
  const idErrId = `${uid}-id-err`;
  const everyErrId = `${uid}-every-err`;
  const promptErrId = `${uid}-prompt-err`;

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
        <div className="flex flex-col gap-1 sm:flex-1">
          <label htmlFor={idId} className="text-xs font-medium text-muted-foreground">Schedule ID</label>
          <input
            id={idId}
            type="text"
            placeholder="health-check"
            value={id}
            onChange={(e) => setId(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, id: true }))}
            aria-invalid={idError ? true : undefined}
            aria-describedby={idError ? idErrId : undefined}
            className={inputClass}
          />
          {idError && <span id={idErrId} className="text-xs text-destructive">{idError}</span>}
        </div>
        <div className="flex flex-col gap-1 sm:w-28">
          <label htmlFor={everyId} className="text-xs font-medium text-muted-foreground">Interval</label>
          <input
            id={everyId}
            type="text"
            placeholder="5m"
            value={every}
            onChange={(e) => setEvery(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, every: true }))}
            aria-invalid={everyError ? true : undefined}
            aria-describedby={everyError ? everyErrId : undefined}
            className={inputClass}
          />
          {everyError && <span id={everyErrId} className="text-xs text-destructive">{everyError}</span>}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={promptId} className="text-xs font-medium text-muted-foreground">Prompt</label>
        <textarea
          id={promptId}
          placeholder="What should the bot do?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, prompt: true }))}
          rows={2}
          aria-invalid={promptError ? true : undefined}
          aria-describedby={promptError ? promptErrId : undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
        />
        {promptError && <span id={promptErrId} className="text-xs text-destructive">{promptError}</span>}
      </div>
      {serverError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {serverError}
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="min-h-11 sm:min-h-0" disabled={submitting || !canSubmit}>
          {submitting && <Loader2Icon className="size-4 animate-spin" />}
          Add Schedule
        </Button>
      </div>
    </form>
  );
}
