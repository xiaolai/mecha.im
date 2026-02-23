"use client";

import { useMemo } from "react";
import { LayoutDashboardIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RailNodeGroup } from "./RailNodeGroup";
import { RailFooter } from "./RailFooter";
import { useDashboardStore } from "@/lib/store";

export function MechaRail() {
  const mechas = useDashboardStore((s) => s.mechas);
  const selectedMechaId = useDashboardStore((s) => s.selectedMechaId);
  const setSelectedMechaId = useDashboardStore((s) => s.setSelectedMechaId);
  const collapsedNodes = useDashboardStore((s) => s.collapsedNodes);
  const toggleNodeCollapsed = useDashboardStore((s) => s.toggleNodeCollapsed);

  const nodeGroups = useMemo(() => {
    const groups: Record<string, typeof mechas> = {};
    for (const m of mechas) {
      const node = m.node || "local";
      (groups[node] ??= []).push(m);
    }
    return groups;
  }, [mechas]);

  return (
    <div className="flex h-full w-12 flex-col items-center border-r border-border bg-sidebar">
      {/* Logo / brand */}
      <div className="flex size-12 shrink-0 items-center justify-center">
        <LayoutDashboardIcon className="size-5 text-primary" />
      </div>

      {/* Mecha icons grouped by node */}
      <ScrollArea className="flex-1 w-full">
        <div className="flex flex-col items-center gap-1 px-1.5 py-2">
          {Object.entries(nodeGroups).map(([node, nodeMechas]) => (
            <RailNodeGroup
              key={node}
              node={node}
              mechas={nodeMechas}
              selectedMechaId={selectedMechaId}
              onSelectMecha={setSelectedMechaId}
              collapsed={collapsedNodes[node] ?? false}
              onToggleCollapse={() => toggleNodeCollapsed(node)}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Footer: create, theme */}
      <RailFooter />
    </div>
  );
}
