"use client";

import { useTheme } from "next-themes";
import { MenuIcon, MoonIcon, SunIcon } from "lucide-react";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";

interface TopbarProps {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-3">
        <div className="md:hidden">
          <TooltipIconButton
            tooltip="Open menu"
            variant="ghost"
            size="icon-sm"
            onClick={onMenuClick}
          >
            <MenuIcon className="size-4" />
          </TooltipIconButton>
        </div>
        <span className="text-sm font-semibold text-foreground md:hidden">mecha</span>
      </div>

      <TooltipIconButton
        tooltip={resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        variant="ghost"
        size="icon-sm"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      >
        <SunIcon className="size-4 rotate-0 scale-100 transition-transform dark:hidden dark:-rotate-90 dark:scale-0" />
        <MoonIcon className="hidden size-4 rotate-90 scale-0 transition-transform dark:block dark:rotate-0 dark:scale-100" />
      </TooltipIconButton>
    </header>
  );
}
