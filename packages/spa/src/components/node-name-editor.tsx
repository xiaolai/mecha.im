import { useState } from "react";
import {
  PencilIcon,
  CheckIcon,
  XIcon,
  Loader2Icon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useAuth } from "@/auth-context";

export function NodeNameEditor({ currentName }: { currentName: string }) {
  const { authHeaders } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState(currentName);

  async function save() {
    if (!draft.trim() || draft === savedName) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/settings/node", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ name: draft.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setError(body.error ?? "Failed to rename node");
        return;
      }
      const data = await res.json();
      setSavedName(data.name);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(savedName);
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    return (
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-muted-foreground shrink-0">Node Name</span>
        <div className="flex items-center gap-1">
          <span className="font-mono text-card-foreground">{savedName}</span>
          <TooltipIconButton
            tooltip="Rename node"
            variant="ghost"
            size="icon-xs"
            onClick={() => { setDraft(savedName); setEditing(true); }}
          >
            <PencilIcon className="size-3" />
          </TooltipIconButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-7 text-sm font-mono flex-1"
          placeholder="node-name"
          disabled={saving}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
        />
        <TooltipIconButton
          tooltip="Save"
          variant="ghost"
          size="icon-xs"
          disabled={saving}
          onClick={save}
        >
          {saving ? <Loader2Icon className="size-3 animate-spin" /> : <CheckIcon className="size-3" />}
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Cancel"
          variant="ghost"
          size="icon-xs"
          disabled={saving}
          onClick={cancel}
        >
          <XIcon className="size-3" />
        </TooltipIconButton>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
