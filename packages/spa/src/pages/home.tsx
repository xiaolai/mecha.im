import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { RefreshCwIcon, SquareIcon, ArrowLeftIcon, PlusIcon } from "lucide-react";
import { BotList } from "@/components/bot-list";
import { BotSpawnForm } from "@/components/bot-spawn-form";
import { MeterSummary } from "@/components/meter-summary";
import { Button } from "@/components/ui/button";
import { BatchActionDialog } from "@/components/batch-action-dialog";

/** Dashboard home page displaying bot list, meter summary, and batch actions. */
export function HomePage() {
  const [searchParams] = useSearchParams();
  const node = searchParams.get("node") ?? undefined;
  const [batchAction, setBatchAction] = useState<"stop" | "restart" | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {!node && <MeterSummary />}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {node && (
              <Link to="/nodes" className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" aria-label="Back to nodes">
                <ArrowLeftIcon className="size-4" />
              </Link>
            )}
            <h1 className="text-lg font-semibold text-foreground">
              {node ? `bots on ${node}` : "bots"}
            </h1>
          </div>
          {!node && (
            <div className="flex items-center gap-2">
              <Button variant="default" size="sm" onClick={() => setSpawnOpen(true)}>
                <PlusIcon className="size-4" /> New Bot
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBatchAction("restart")}>
                <RefreshCwIcon className="size-4" /> Restart All
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBatchAction("stop")}>
                <SquareIcon className="size-4" /> Stop All
              </Button>
            </div>
          )}
        </div>
        <BotList node={node} />
      </div>

      {batchAction && (
        <BatchActionDialog
          action={batchAction}
          open={!!batchAction}
          onOpenChange={(open) => { if (!open) setBatchAction(null); }}
        />
      )}

      <BotSpawnForm open={spawnOpen} onOpenChange={setSpawnOpen} onCreated={() => {}} />
    </div>
  );
}
