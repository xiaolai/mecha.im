"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SaveIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

interface SessionConfig {
  model?: string;
  permissionMode?: string;
  systemPrompt?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

interface SessionConfigEditorProps {
  mechaId: string;
  sessionId: string;
  initialConfig: Record<string, unknown>;
  onSaved?: () => void;
}

const PERMISSION_MODES = ["default", "plan", "full-auto"] as const;

export function SessionConfigEditor({ mechaId, sessionId, initialConfig, onSaved }: SessionConfigEditorProps) {
  const [config, setConfig] = useState<SessionConfig>(initialConfig as SessionConfig);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Reset local state when session changes (initialConfig will change)
  useEffect(() => {
    setConfig(initialConfig as SessionConfig);
    setExpanded(false);
    setError("");
    setSuccess(false);
  }, [initialConfig, mechaId, sessionId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const res = await fetch(`/api/mechas/${mechaId}/sessions/${sessionId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? `Save failed (${res.status})`);
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
        onSaved?.();
      }
    } catch {
      setError("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }, [mechaId, sessionId, config, onSaved]);

  const updateField = useCallback(<K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
        Edit configuration
      </button>

      {expanded && (
        <div className="mt-3 rounded-lg border border-border bg-card p-4 space-y-4">
          {/* Model */}
          <fieldset className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            <Input
              value={config.model ?? ""}
              onChange={(e) => updateField("model", e.target.value || undefined)}
              placeholder="(default)"
              className="h-9 font-mono text-sm"
            />
          </fieldset>

          {/* Permission mode */}
          <fieldset className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Permission mode</label>
            <Select
              value={config.permissionMode ?? "default"}
              onValueChange={(v) => updateField("permissionMode", v === "default" ? undefined : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </fieldset>

          {/* System prompt */}
          <fieldset className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">System prompt</label>
            <textarea
              value={config.systemPrompt ?? ""}
              onChange={(e) => updateField("systemPrompt", e.target.value || undefined)}
              placeholder="(none)"
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground outline-none resize-y min-h-20"
            />
          </fieldset>

          {/* Max turns & Max budget */}
          <div className="grid grid-cols-2 gap-3">
            <fieldset className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Max turns</label>
              <Input
                type="number"
                min={1}
                value={config.maxTurns ?? ""}
                onChange={(e) => updateField("maxTurns", e.target.value ? parseInt(e.target.value, 10) : undefined)}
                placeholder="(unlimited)"
                className="h-9 text-sm"
              />
            </fieldset>
            <fieldset className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Max budget (USD)</label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={config.maxBudgetUsd ?? ""}
                onChange={(e) => updateField("maxBudgetUsd", e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="(unlimited)"
                className="h-9 text-sm"
              />
            </fieldset>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={saving}
              onClick={handleSave}
            >
              <SaveIcon className="size-3.5 mr-1.5" />
              {saving ? "Saving..." : "Save"}
            </Button>
            {error && <span className="text-xs text-destructive">{error}</span>}
            {success && <span className="text-xs text-success">Saved</span>}
          </div>
        </div>
      )}
    </div>
  );
}
