"use client";

import { XTerminal } from "@/components/terminal/XTerminal";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { PaneNode, SplitDirection } from "./terminal-state";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  SplitIcon,
  ColumnsIcon,
  XIcon,
} from "lucide-react";

interface TerminalPaneTreeProps {
  mechaId: string;
  node: PaneNode;
  onSplit: (paneId: string, direction: SplitDirection) => void;
  onClose: (paneId: string) => void;
  canClose: boolean;
}

export function TerminalPaneTree({
  mechaId,
  node,
  onSplit,
  onClose,
  canClose,
}: TerminalPaneTreeProps) {
  if (node.kind === "leaf") {
    return (
      <div className="relative size-full min-h-0 group/pane">
        {/* Pane toolbar — top-right overlay */}
        <div className="absolute top-1 right-1 z-10 flex gap-0.5 sm:opacity-0 sm:group-hover/pane:opacity-100 transition-opacity">
          <TooltipIconButton
            tooltip="Split right"
            size="icon-xs"
            variant="secondary"
            onClick={() => onSplit(node.id, "horizontal")}
          >
            <ColumnsIcon />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="Split down"
            size="icon-xs"
            variant="secondary"
            onClick={() => onSplit(node.id, "vertical")}
          >
            <SplitIcon />
          </TooltipIconButton>
          {canClose && (
            <TooltipIconButton
              tooltip="Close pane"
              size="icon-xs"
              variant="secondary"
              onClick={() => onClose(node.id)}
            >
              <XIcon />
            </TooltipIconButton>
          )}
        </div>
        <XTerminal mechaId={mechaId} />
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation={node.direction}>
      <ResizablePanel minSize={15}>
        <TerminalPaneTree
          mechaId={mechaId}
          node={node.children[0]}
          onSplit={onSplit}
          onClose={onClose}
          canClose
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel minSize={15}>
        <TerminalPaneTree
          mechaId={mechaId}
          node={node.children[1]}
          onSplit={onSplit}
          onClose={onClose}
          canClose
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
