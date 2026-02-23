"use client";

import { ChevronRightIcon, MenuIcon, StopCircleIcon, PlayIcon } from "lucide-react";
import { useDashboardStore } from "@/lib/store";
import { useCallback, useState } from "react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";

export function TopBar() {
  const mechas = useDashboardStore((s) => s.mechas);
  const selectedMechaId = useDashboardStore((s) => s.selectedMechaId);
  const activeTab = useDashboardStore((s) => s.activeTab);
  const sessionsPanelOpen = useDashboardStore((s) => s.sessionsPanelOpen);
  const setSessionsPanelOpen = useDashboardStore((s) => s.setSessionsPanelOpen);

  const selectedMecha = mechas.find((m) => m.id === selectedMechaId);
  const [acting, setActing] = useState(false);

  const toggleMecha = useCallback(async () => {
    if (!selectedMechaId || acting) return;
    setActing(true);
    const isRunning = selectedMecha?.state === "running";
    const action = isRunning ? "stop" : "start";
    try {
      await fetch(`/api/mechas/${selectedMechaId}/${action}`, { method: "POST" });
    } finally {
      setActing(false);
    }
  }, [selectedMechaId, selectedMecha, acting]);

  const tabLabels: Record<string, string> = {
    chat: "Chat",
    overview: "Overview",
    terminal: "Terminal",
    inspect: "Inspect",
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 bg-background px-4">
      {/* Mobile menu button */}
      <TooltipIconButton
        tooltip="Toggle sidebar"
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={() => setSessionsPanelOpen(!sessionsPanelOpen)}
      >
        <MenuIcon className="size-4" />
      </TooltipIconButton>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm min-w-0">
        {selectedMecha ? (
          <>
            <span className="text-muted-foreground truncate max-w-24">
              {selectedMecha.node}
            </span>
            <ChevronRightIcon className="size-3 text-muted-foreground shrink-0" />
            <span className="font-medium font-mono truncate max-w-36">
              {selectedMecha.id}
            </span>
            <ChevronRightIcon className="size-3 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{tabLabels[activeTab]}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Mecha Dashboard</span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Quick actions */}
      {selectedMecha && (
        <div className="flex items-center gap-1.5">
          {/* Status badge */}
          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border border-border">
            <span
              className={`size-1.5 rounded-full ${
                selectedMecha.state === "running" ? "bg-success" : selectedMecha.state === "exited" || selectedMecha.state === "dead" ? "bg-destructive" : "bg-warning"
              }`}
            />
            {selectedMecha.state}
          </span>

          {/* Start/Stop toggle */}
          <TooltipIconButton
            tooltip={selectedMecha.state === "running" ? "Stop" : "Start"}
            variant="ghost"
            size="icon-sm"
            onClick={toggleMecha}
            disabled={acting}
          >
            {selectedMecha.state === "running" ? (
              <StopCircleIcon className="size-4 text-warning" />
            ) : (
              <PlayIcon className="size-4 text-success" />
            )}
          </TooltipIconButton>
        </div>
      )}
    </div>
  );
}
