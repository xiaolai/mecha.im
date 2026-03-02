import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BusyWarning } from "@/lib/use-casa-action";

interface BusyWarningBannerProps {
  warning: BusyWarning;
  onConfirm: () => void;
  onCancel: () => void;
  acting: boolean;
}

export function BusyWarningBanner({ warning, onConfirm, onCancel, acting }: BusyWarningBannerProps) {
  const label = warning.pendingAction === "restart" ? "Force Restart" : "Force Stop";

  return (
    <div className="relative z-10 rounded-md border border-warning/50 bg-warning/10 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="size-4 text-warning shrink-0 mt-0.5" />
        <div className="flex flex-col gap-2 min-w-0">
          <div className="text-xs font-medium text-foreground">Active Tasks Detected</div>
          <div className="text-xs text-muted-foreground">
            {warning.activeSessions} active session{warning.activeSessions === 1 ? "" : "s"}
            {warning.lastActivity && (
              <> — last activity {new Date(warning.lastActivity).toLocaleTimeString()}</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="xs"
              disabled={acting}
              onClick={onConfirm}
            >
              {label}
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
    </div>
  );
}
