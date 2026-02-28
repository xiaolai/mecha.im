"use client";

import { useState } from "react";
import Link from "next/link";
import { SquareIcon, OctagonXIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { stateStyles } from "@/lib/casa-styles";

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

export function CasaCard({ casa }: CasaCardProps) {
  const style = stateStyles[casa.state];
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  async function handleAction(action: "stop" | "kill") {
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/casas/${encodeURIComponent(casa.name)}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setActionError(body.error ?? `Failed to ${action}`);
      }
    } catch {
      setActionError(`Failed to ${action} — connection error`);
    } finally {
      setActing(false);
    }
  }

  return (
    <Link
      href={`/casa/${encodeURIComponent(casa.name)}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
    >
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

      {/* Action error */}
      {actionError && (
        <div className="text-xs text-destructive">{actionError}</div>
      )}

      {/* Actions */}
      {casa.state === "running" && (
        <div className="flex items-center gap-2 border-t border-border pt-2" onClick={(e) => e.preventDefault()}>
          <TooltipIconButton
            tooltip="Stop"
            variant="outline"
            size="icon-sm"
            disabled={acting}
            onClick={() => handleAction("stop")}
          >
            <SquareIcon className="size-4" />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="Kill"
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            disabled={acting}
            onClick={() => handleAction("kill")}
          >
            <OctagonXIcon className="size-4" />
          </TooltipIconButton>
        </div>
      )}
    </Link>
  );
}
