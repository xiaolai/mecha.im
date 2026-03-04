import { useState } from "react";
import { RefreshCwIcon, SquareIcon } from "lucide-react";
import { CasaList } from "@/components/casa-list";
import { MeterSummary } from "@/components/meter-summary";
import { Button } from "@/components/ui/button";
import { BatchActionDialog } from "@/components/batch-action-dialog";

export function HomePage() {
  const [batchAction, setBatchAction] = useState<"stop" | "restart" | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <MeterSummary />
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">CASAs</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setBatchAction("restart")}>
              <RefreshCwIcon className="size-4" /> Restart All
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBatchAction("stop")}>
              <SquareIcon className="size-4" /> Stop All
            </Button>
          </div>
        </div>
        <CasaList />
      </div>

      {batchAction && (
        <BatchActionDialog
          action={batchAction}
          open={!!batchAction}
          onOpenChange={(open) => { if (!open) setBatchAction(null); }}
        />
      )}
    </div>
  );
}
