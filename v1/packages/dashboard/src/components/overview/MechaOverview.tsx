"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { MechaSettings } from "@/components/MechaSettings";
import { MechaMcp } from "@/components/MechaMcp";
import { MechaUpdate } from "@/components/MechaUpdate";
import { useDashboardStore } from "@/lib/store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PlayIcon,
  StopCircleIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";

interface MechaOverviewProps {
  mechaId: string;
  isRunning: boolean;
}

export function MechaOverview({ mechaId, isRunning }: MechaOverviewProps) {
  const mechas = useDashboardStore((s) => s.mechas);
  const setSelectedMechaId = useDashboardStore((s) => s.setSelectedMechaId);
  const mecha = mechas.find((m) => m.id === mechaId);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeWithState, setRemoveWithState] = useState(false);

  const doAction = useCallback(async (action: string) => {
    setActing(true);
    setError("");
    try {
      const res = await fetch(`/api/mechas/${mechaId}/${action}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? `Action failed (${res.status})`);
      }
    } finally {
      setActing(false);
    }
  }, [mechaId]);

  const doRemove = useCallback(async () => {
    setConfirmRemove(false);
    setActing(true);
    try {
      const url = `/api/mechas/${mechaId}${removeWithState ? "?withState=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) {
        setSelectedMechaId(null);
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? `Remove failed (${res.status})`);
      }
    } finally {
      setActing(false);
      setRemoveWithState(false);
    }
  }, [mechaId, removeWithState, setSelectedMechaId]);

  if (!mecha) return null;

  const port = mecha.port || mecha.ports?.find((p) => p.PublicPort)?.PublicPort;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <InfoCard label="Container" value={mecha.name || mechaId} />
        <InfoCard label="State" value={mecha.state} />
        <InfoCard label="Port" value={port ? `:${port}` : "\u2014"} />
        <InfoCard label="Node" value={mecha.node} />
        <InfoCard label="Path" value={mecha.path || "\u2014"} />
        <InfoCard
          label="Created"
          value={mecha.created ? new Date(mecha.created * 1000).toLocaleDateString() : "\u2014"}
        />
      </div>

      {/* Quick actions */}
      <div>
        <h3 className="text-sm font-medium mb-2">Actions</h3>
        <div className="flex flex-wrap gap-2">
          {!isRunning && (
            <Button
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={() => doAction("start")}
              className="border-success text-success hover:bg-success/10"
            >
              <PlayIcon className="size-3.5 mr-1.5" />
              Start
            </Button>
          )}
          {isRunning && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={() => doAction("stop")}
                className="border-warning text-warning hover:bg-warning/10"
              >
                <StopCircleIcon className="size-3.5 mr-1.5" />
                Stop
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={() => doAction("restart")}
              >
                <RefreshCwIcon className="size-3.5 mr-1.5" />
                Restart
              </Button>
            </>
          )}
          <MechaUpdate mechaId={mechaId} />
          <Button
            variant="outline"
            size="sm"
            disabled={acting}
            onClick={() => setConfirmRemove(true)}
            className="border-destructive text-destructive hover:bg-destructive/10"
          >
            <Trash2Icon className="size-3.5 mr-1.5" />
            Remove
          </Button>
        </div>
        {error && (
          <p className="text-xs text-destructive mt-2">{error}</p>
        )}
      </div>

      <Separator />

      {/* Settings */}
      <div>
        <h3 className="text-sm font-medium mb-3">Settings</h3>
        <div className="rounded-lg border border-border bg-card p-4">
          <MechaSettings mechaId={mechaId} />
        </div>
      </div>

      {/* MCP */}
      {isRunning && (
        <>
          <Separator />
          <div>
            <h3 className="text-sm font-medium mb-3">MCP Server</h3>
            <div className="rounded-lg border border-border bg-card p-4">
              <MechaMcp mechaId={mechaId} />
            </div>
          </div>
        </>
      )}

      {/* Remove dialog */}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Mecha</DialogTitle>
            <DialogDescription>
              Remove <code className="text-foreground font-mono">{mechaId}</code>? This will delete the container.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={removeWithState}
              onChange={(e) => setRemoveWithState(e.target.checked)}
            />
            Also remove state volume
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doRemove}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-mono overflow-hidden text-ellipsis whitespace-nowrap">{value}</div>
    </div>
  );
}
