"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UpdateResult {
  id: string;
  image: string;
  previousImage: string;
}

export function MechaUpdate({ mechaId }: { mechaId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [noPull, setNoPull] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [error, setError] = useState("");

  const doUpdate = useCallback(async () => {
    setConfirming(false);
    setUpdating(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`/api/mechas/${mechaId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noPull }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      const data = await res.json() as UpdateResult;
      setResult(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setUpdating(false);
    }
  }, [mechaId, noPull, router]);

  return (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={() => setConfirming(true)}
        disabled={updating}
        className="border-primary text-primary hover:bg-primary/10"
      >
        {updating ? "Updating..." : "Update"}
      </Button>

      {result && (
        <span className="text-xs text-success ml-2">
          {result.previousImage} → {result.image}
        </span>
      )}
      {error && (
        <span className="text-xs text-destructive ml-2">{error}</span>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Mecha</DialogTitle>
            <DialogDescription>
              This will pull the latest image, stop the container, recreate it, and start it again.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={noPull}
              onChange={(e) => setNoPull(e.target.checked)}
            />
            Skip image pull (use local image)
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={doUpdate}>
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
