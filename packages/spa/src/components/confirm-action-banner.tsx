import { Button } from "@/components/ui/button";
import type { CasaActionType } from "@/lib/use-casa-action";

const ACTION_LABELS: Partial<Record<CasaActionType, { verb: string; description: string }>> = {
  stop: { verb: "Stop", description: "This will gracefully stop the CASA." },
  restart: { verb: "Restart", description: "This will stop and re-spawn the CASA." },
  kill: { verb: "Kill", description: "This will force-kill the CASA immediately." },
};

interface ConfirmActionBannerProps {
  action: CasaActionType;
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  acting: boolean;
}

export function ConfirmActionBanner({ action, name, onConfirm, onCancel, acting }: ConfirmActionBannerProps) {
  const { verb, description } = ACTION_LABELS[action] ?? ACTION_LABELS.stop;

  return (
    <div className="relative z-10 rounded-md border border-border bg-muted/50 p-3">
      <div className="flex flex-col gap-2">
        <div className="text-xs text-muted-foreground">
          {verb} <span className="font-mono font-medium text-foreground">{name}</span>? {description}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={action === "kill" ? "destructive" : "default"}
            size="xs"
            disabled={acting}
            onClick={onConfirm}
          >
            {verb}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={acting}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
