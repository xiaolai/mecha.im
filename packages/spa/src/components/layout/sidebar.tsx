import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BoxIcon,
  CalendarClockIcon,
  NetworkIcon,
  ScrollTextIcon,
  SettingsIcon,
  XIcon,
  LogOutIcon,
  DollarSignIcon,
  HeartPulseIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useAuth } from "@/auth-context";

const navSections = [
  {
    label: "Bots",
    items: [
      { href: "/", label: "Bots", icon: BoxIcon },
      { href: "/schedules", label: "Schedules", icon: CalendarClockIcon },
      { href: "/budgets", label: "Budgets", icon: DollarSignIcon },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/nodes", label: "Nodes", icon: NetworkIcon },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/audit", label: "Audit & Events", icon: ScrollTextIcon },
      { href: "/doctor", label: "Doctor", icon: HeartPulseIcon },
      { href: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function LogoutButton({ logout, collapsed }: { logout: () => void; collapsed: boolean }) {
  const [pending, setPending] = useState(false);

  if (collapsed) {
    return (
      <TooltipIconButton
        tooltip={pending ? "Logging out…" : "Log out"}
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        onClick={() => { setPending(true); logout(); }}
      >
        <LogOutIcon className="size-4" />
      </TooltipIconButton>
    );
  }

  return (
    <button
      disabled={pending}
      onClick={() => { setPending(true); logout(); }}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        pending && "opacity-50 pointer-events-none",
      )}
    >
      <LogOutIcon className="size-4" />
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

export function Sidebar({ open, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const { pathname } = useLocation();
  const { logout } = useAuth();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // On mobile (drawer open), always show expanded — collapsed only applies on desktop
  const isCollapsed = collapsed && !open;

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-sidebar-border bg-sidebar md:static md:z-auto",
          "transition-all duration-200 md:translate-x-0",
          isCollapsed ? "md:w-14" : "w-56",
          open ? "translate-x-0 w-56" : "-translate-x-full",
        )}
      >
        {/* Header */}
        <div className={cn("flex h-12 items-center", isCollapsed ? "justify-center px-2" : "justify-between px-4")}>
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <img src="/images/logo-40.png" alt="" className="size-6" />
              <span className="text-sm font-semibold text-sidebar-foreground">MECHA</span>
            </div>
          )}
          {isCollapsed && (
            <img src="/images/logo-40.png" alt="" className="size-6" />
          )}
          <div className="md:hidden">
            <TooltipIconButton
              tooltip="Close sidebar"
              variant="ghost"
              size="icon"
              className="sm:size-8"
              onClick={onClose}
            >
              <XIcon className="size-4" />
            </TooltipIconButton>
          </div>
        </div>

        {/* Nav */}
        <nav className={cn("flex-1 overflow-y-auto py-2", isCollapsed ? "px-1" : "px-2")}>
          {navSections.map((section) => (
            <div key={section.label} className="mb-3">
              {!isCollapsed && (
                <div className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </div>
              )}
              {isCollapsed && <div className="my-1 mx-2 border-t border-sidebar-border" />}
              <div className="space-y-0.5">
                {section.items.map(({ href, label, icon: Icon }) => {
                  const active = href === "/"
                    ? pathname === "/" || pathname.startsWith("/bot/")
                    : pathname === href || pathname.startsWith(`${href}/`);

                  if (isCollapsed) {
                    return (
                      <Tooltip key={href}>
                        <TooltipTrigger asChild>
                          <Link
                            to={href}
                            onClick={onClose}
                            className={cn(
                              "flex items-center justify-center rounded-md p-2 transition-colors",
                              active
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            )}
                          >
                            <Icon className="size-4" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right">{label}</TooltipContent>
                      </Tooltip>
                    );
                  }

                  return (
                    <Link
                      key={href}
                      to={href}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className={cn("flex flex-col items-center gap-2 pb-4", isCollapsed ? "px-2" : "px-4")}>
          {!isCollapsed && <img src="/images/login-bg.png" alt="" className="size-24 opacity-60" />}
          <LogoutButton logout={logout} collapsed={isCollapsed} />
          {/* Collapse toggle — desktop only */}
          <div className="hidden md:flex">
            <TooltipIconButton
              tooltip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              variant="ghost"
              size="icon-sm"
              onClick={onToggleCollapse}
            >
              {collapsed ? <PanelLeftOpenIcon className="size-4" /> : <PanelLeftCloseIcon className="size-4" />}
            </TooltipIconButton>
          </div>
        </div>
      </aside>
    </>
  );
}
