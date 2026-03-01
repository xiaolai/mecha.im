import { useTheme } from "next-themes";
import { MenuIcon, MoonIcon, SunIcon, LogOutIcon } from "lucide-react";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useAuth } from "@/auth-context";

interface TopbarProps {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { logout } = useAuth();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-3">
        <div className="md:hidden">
          <TooltipIconButton
            tooltip="Open menu"
            variant="ghost"
            size="icon"
            className="sm:size-8"
            onClick={onMenuClick}
          >
            <MenuIcon className="size-4" />
          </TooltipIconButton>
        </div>
        <span className="text-sm font-semibold text-foreground md:hidden">mecha</span>
      </div>

      <div className="flex items-center gap-2">
        <TooltipIconButton
          tooltip={resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          variant="ghost"
          size="icon"
          className="sm:size-8"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <SunIcon className="size-4 rotate-0 scale-100 transition-transform dark:hidden dark:-rotate-90 dark:scale-0" />
          <MoonIcon className="hidden size-4 rotate-90 scale-0 transition-transform dark:block dark:rotate-0 dark:scale-100" />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Logout"
          variant="ghost"
          size="icon"
          className="sm:size-8"
          onClick={logout}
        >
          <LogOutIcon className="size-4" />
        </TooltipIconButton>
      </div>
    </header>
  );
}
