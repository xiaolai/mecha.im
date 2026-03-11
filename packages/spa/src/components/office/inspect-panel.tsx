import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InspectPanelProps {
  botName: string;
  onClose: () => void;
}

export function InspectPanel({ botName, onClose }: InspectPanelProps) {
  return (
    <div className="w-72 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-card-foreground">{botName}</h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <div>Activity: loading...</div>
        <div>Session: -</div>
      </div>
    </div>
  );
}
