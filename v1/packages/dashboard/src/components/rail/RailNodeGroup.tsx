"use client";

import { ChevronDownIcon, MonitorIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RailMechaIcon } from "./RailMechaIcon";
import type { MechaWithNode } from "@/lib/store";

interface RailNodeGroupProps {
  node: string;
  mechas: MechaWithNode[];
  selectedMechaId: string | null;
  onSelectMecha: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function RailNodeGroup({
  node,
  mechas,
  selectedMechaId,
  onSelectMecha,
  collapsed,
  onToggleCollapse,
}: RailNodeGroupProps) {
  const anyRunning = mechas.some((m) => m.state === "running");
  const isActive = mechas.some((m) => m.id === selectedMechaId);

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Node icon */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggleCollapse}
            className={cn(
              "relative flex size-9 items-center justify-center transition-all",
              isActive
                ? "text-primary"
                : anyRunning
                  ? "text-foreground"
                  : "text-muted-foreground",
            )}
          >
            <MonitorIcon className="size-5" />
            <ChevronDownIcon
              className={cn(
                "absolute -bottom-1 left-1/2 -translate-x-1/2 size-2.5 text-muted-foreground transition-transform",
                collapsed && "-rotate-90",
              )}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <span>{node}</span>
          <span className="text-muted-foreground ml-1">({mechas.length})</span>
        </TooltipContent>
      </Tooltip>

      {/* CASA icons */}
      {!collapsed && (
        <div className="flex flex-col items-center gap-1">
          {mechas.map((m) => (
            <RailMechaIcon
              key={m.id}
              id={m.id}
              name={m.name}
              state={m.state}
              path={m.path}
              isActive={selectedMechaId === m.id}
              onClick={() => onSelectMecha(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
