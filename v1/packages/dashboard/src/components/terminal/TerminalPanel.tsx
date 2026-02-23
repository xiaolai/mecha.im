"use client";

import { useCallback, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { TerminalPaneTree } from "@/components/terminal/TerminalPaneTree";
import {
  createTab,
  splitPane,
  removePane,
  countPanes,
  type TerminalTab,
  type SplitDirection,
} from "./terminal-state";
import { cn } from "@/lib/utils";

interface TerminalPanelProps {
  mechaId: string;
  isRunning: boolean;
}

export function TerminalPanel({ mechaId, isRunning }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [createTab(1)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [tabCounter, setTabCounter] = useState(1);

  const addTab = useCallback(() => {
    setTabCounter((c) => {
      const next = c + 1;
      const tab = createTab(next);
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      return next;
    });
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev;
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId) {
          const newIdx = Math.min(idx, next.length - 1);
          setActiveTabId(next[newIdx].id);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const handleSplit = useCallback(
    (paneId: string, direction: SplitDirection) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? { ...tab, root: splitPane(tab.root, paneId, direction) }
            : tab,
        ),
      );
    },
    [activeTabId],
  );

  const handleClosePane = useCallback(
    (paneId: string) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          const newRoot = removePane(tab.root, paneId);
          return newRoot ? { ...tab, root: newRoot } : tab;
        }),
      );
    },
    [activeTabId],
  );

  if (!isRunning) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          Start the mecha to access the terminal.
        </p>
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-muted/30 px-1">
        <div className="flex items-center gap-0.5 overflow-x-auto min-w-0 flex-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "group/tab relative flex items-center gap-1 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                tab.id === activeTabId
                  ? "text-foreground bg-background border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tabs.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }
                  }}
                  className="sm:opacity-0 sm:group-hover/tab:opacity-100 rounded-sm p-0.5 hover:bg-muted transition-opacity"
                >
                  <XIcon className="size-3" />
                </span>
              )}
            </button>
          ))}
        </div>
        <TooltipIconButton
          tooltip="New terminal"
          size="icon-xs"
          variant="ghost"
          onClick={addTab}
          className="mx-1 shrink-0"
        >
          <PlusIcon />
        </TooltipIconButton>
      </div>

      {/* Pane content */}
      <div className="flex-1 min-h-0">
        <TerminalPaneTree
          mechaId={mechaId}
          node={activeTab.root}
          onSplit={handleSplit}
          onClose={handleClosePane}
          canClose={countPanes(activeTab.root) > 1}
        />
      </div>
    </div>
  );
}
