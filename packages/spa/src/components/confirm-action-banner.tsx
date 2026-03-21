import { Button } from "@/components/ui/button";
import type { BotActionType } from "@/lib/use-bot-action";

const ACTION_LABELS: Partial<Record<BotActionType, { verb: string; description: string }>> = {
  stop: { verb: "Stop", description: "This will gracefully stop the bot." },
  restart: { verb: "Restart", description: "This will stop and re-spawn the bot." },
  kill: { verb: "Kill", description: "This will force-kill the bot immediately." },
};

interface ConfirmActionBannerProps {
  action: BotActionType;
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  acting: boolean;
}

/** Renders a confirmation banner for destructive bot actions (stop, restart, kill). */
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
