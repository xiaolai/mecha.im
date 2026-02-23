"use client";

import { MessageSquareIcon, InfoIcon, TerminalIcon, SearchCodeIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import type { ActiveTab } from "@/lib/store";

interface SessionTabsProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

const tabs: Array<{ id: ActiveTab; label: string; icon: typeof MessageSquareIcon }> = [
  { id: "chat", label: "Chat", icon: MessageSquareIcon },
  { id: "overview", label: "Info", icon: InfoIcon },
  { id: "terminal", label: "Terminal", icon: TerminalIcon },
  { id: "inspect", label: "Inspect", icon: SearchCodeIcon },
];

export function SessionTabs({ activeTab, onTabChange }: SessionTabsProps) {
  return (
    <div className="flex items-center justify-around py-1">
      {tabs.map((tab) => (
        <TooltipIconButton
          key={tab.id}
          tooltip={tab.label}
          variant="ghost"
          size="icon-sm"
          onClick={() => onTabChange(tab.id)}
          className={cn(
            activeTab === tab.id
              ? "text-sidebar-primary"
              : "text-muted-foreground",
          )}
        >
          <tab.icon className="size-4" />
        </TooltipIconButton>
      ))}
    </div>
  );
}
