import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BoxIcon,
  CalendarClockIcon,
  NetworkIcon,
  ShieldCheckIcon,
  ScrollTextIcon,
  SettingsIcon,
  XIcon,
  LogOutIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useAuth } from "@/auth-context";

const navItems = [
  { href: "/nodes", label: "Nodes", icon: NetworkIcon },
  { href: "/", label: "Bots", icon: BoxIcon },
  { href: "/schedules", label: "Schedules", icon: CalendarClockIcon },
  { href: "/acl", label: "ACL", icon: ShieldCheckIcon },
  { href: "/audit", label: "Logs", icon: ScrollTextIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

function LogoutButton({ logout }: { logout: () => void }) {
  const [pending, setPending] = useState(false);
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

export function Sidebar({ open, onClose }: SidebarProps) {
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
          "fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-sidebar-border bg-sidebar md:static md:z-auto",
          "transition-transform duration-200 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex h-12 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img src="/images/logo-40.png" alt="" className="size-6" />
            <span className="text-sm font-semibold text-sidebar-foreground">MECHA</span>
          </div>
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
        <nav className="flex-1 space-y-1 px-2 py-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/"
              ? pathname === "/" || pathname.startsWith("/bot/")
              : pathname === href || pathname.startsWith(`${href}/`);
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
        </nav>

        {/* Footer */}
        <div className="flex flex-col items-center gap-2 px-4 pb-4">
          <img src="/images/login-bg.png" alt="" className="size-24 opacity-60" />
          <LogoutButton logout={logout} />
        </div>
      </aside>
    </>
  );
}
