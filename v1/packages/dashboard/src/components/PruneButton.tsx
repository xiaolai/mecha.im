"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PruneResult {
  removedContainers: string[];
  removedVolumes: string[];
}

export function PruneButton({ prunableCount, onPruned }: { prunableCount: number; onPruned: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [volumes, setVolumes] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [result, setResult] = useState<PruneResult | null>(null);
  const [error, setError] = useState("");

  const doPrune = useCallback(async () => {
    setConfirming(false);
    setPruning(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volumes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      const data = await res.json() as PruneResult;
      setResult(data);
      onPruned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to prune");
    } finally {
      setPruning(false);
    }
  }, [volumes, onPruned]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setResult(null);
          setError("");
          setConfirming(true);
        }}
        disabled={pruning || prunableCount === 0}
        className="border-warning text-warning hover:bg-warning/10"
      >
        {pruning ? "Pruning..." : "Prune"}
      </Button>

      {result && (
        <span className="text-xs text-success ml-2">
          Removed {result.removedContainers.length} container(s)
          {result.removedVolumes.length > 0 && `, ${result.removedVolumes.length} volume(s)`}
        </span>
      )}
      {error && (
        <span className="text-xs text-destructive ml-2">{error}</span>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Prune Mechas</DialogTitle>
            <DialogDescription>
              Remove {prunableCount} stopped/exited container(s)?
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={volumes}
              onChange={(e) => setVolumes(e.target.checked)}
            />
            Also remove state volumes
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              onClick={doPrune}
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              Prune
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
