"use client";

import { BotIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RailMechaIconProps {
  id: string;
  name: string;
  state: string;
  path: string;
  isActive: boolean;
  onClick: () => void;
}

export function RailMechaIcon({ id, name, state, path, isActive, onClick }: RailMechaIconProps) {
  const isRunning = state === "running";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "relative flex size-9 items-center justify-center transition-all",
            isActive
              ? "text-primary"
              : isRunning
                ? "text-foreground"
                : "text-muted-foreground",
          )}
        >
          <BotIcon className="size-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="flex flex-col gap-0.5">
        <span className="font-mono text-xs">{id}</span>
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">{path}</span>
        <span className="text-xs capitalize">{state}</span>
      </TooltipContent>
    </Tooltip>
  );
}
