"use client";

import { SquareIcon, OctagonXIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

export interface CasaInfo {
  name: string;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
  startedAt?: string;
  tags: string[];
}

interface CasaCardProps {
  casa: CasaInfo;
}

const stateStyles = {
  running: { dot: "bg-success", badge: "success" as const },
  stopped: { dot: "bg-muted-foreground", badge: "secondary" as const },
  error: { dot: "bg-destructive", badge: "destructive" as const },
};

export function CasaCard({ casa }: CasaCardProps) {
  const style = stateStyles[casa.state];

  async function handleAction(action: "stop" | "kill") {
    await fetch(`/api/casas/${casa.name}/${action}`, { method: "POST" });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", style.dot)} />
          <span className="text-sm font-semibold text-card-foreground">{casa.name}</span>
        </div>
        <Badge variant={style.badge}>{casa.state}</Badge>
      </div>

      {/* Details */}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {casa.port != null && (
          <span>
            Port: <span className="font-mono">{casa.port}</span>
          </span>
        )}
        <span className="truncate" title={casa.workspacePath}>
          {casa.workspacePath}
        </span>
      </div>

      {/* Tags */}
      {casa.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {casa.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Actions */}
      {casa.state === "running" && (
        <div className="flex items-center gap-2 border-t border-border pt-2">
          <TooltipIconButton
            tooltip="Stop"
            variant="outline"
            size="icon-sm"
            onClick={() => handleAction("stop")}
          >
            <SquareIcon className="size-4" />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="Kill"
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            onClick={() => handleAction("kill")}
          >
            <OctagonXIcon className="size-4" />
          </TooltipIconButton>
        </div>
      )}
    </div>
  );
}
