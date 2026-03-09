import { MenuIcon } from "lucide-react";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";

interface TopbarProps {
  onMenuClick: () => void;
}

/** Mobile topbar header with hamburger menu toggle. */
export function Topbar({ onMenuClick }: TopbarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border px-4 md:hidden">
      <div className="flex items-center gap-3">
        <TooltipIconButton
          tooltip="Open menu"
          variant="ghost"
          size="icon"
          className="sm:size-8"
          onClick={onMenuClick}
        >
          <MenuIcon className="size-4" />
        </TooltipIconButton>
        <span className="text-sm font-semibold text-foreground">mecha</span>
      </div>
    </header>
  );
}
