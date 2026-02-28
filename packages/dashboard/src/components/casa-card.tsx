"use client";

import Link from "next/link";
import { SquareIcon, OctagonXIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { stateStyles } from "@/lib/casa-styles";
import { useCasaAction } from "@/lib/use-casa-action";

export interface CasaInfo {
  name: string;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
  startedAt?: string;
  tags: string[];
  node?: string;
}

interface CasaCardProps {
  casa: CasaInfo;
}

export function CasaCard({ casa }: CasaCardProps) {
  const style = stateStyles[casa.state];
  const { acting, actionError, handleAction } = useCasaAction(casa.name, undefined, casa.node);

  return (
    <div className="relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50">
      <Link
        href={`/casa/${encodeURIComponent(casa.name)}${casa.node && casa.node !== "local" ? `?node=${encodeURIComponent(casa.node)}` : ""}`}
        className="absolute inset-0 rounded-lg"
        aria-label={`View ${casa.name}`}
      />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", style.dot)} />
          <span className="text-sm font-semibold text-card-foreground">{casa.name}</span>
          {casa.node && casa.node !== "local" && (
            <span className="text-xs text-muted-foreground font-mono">@ {casa.node}</span>
          )}
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
        {casa.workspacePath && (
          <span className="truncate" title={casa.workspacePath}>
            {casa.workspacePath}
          </span>
        )}
      </div>

      {/* Tags */}
      {casa.tags && casa.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {casa.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="text-xs text-destructive">{actionError}</div>
      )}

      {/* Actions */}
      {casa.state === "running" && (
        <div className="relative z-10 flex items-center gap-3 border-t border-border pt-2">
          <TooltipIconButton
            tooltip="Stop"
            variant="outline"
            size="icon"
            className="sm:size-8"
            disabled={acting}
            onClick={() => handleAction("stop")}
          >
            <SquareIcon className="size-4" />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="Kill"
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive sm:size-8"
            disabled={acting}
            onClick={() => handleAction("kill")}
          >
            <OctagonXIcon className="size-4" />
          </TooltipIconButton>
        </div>
      )}
    </div>
  );
}
