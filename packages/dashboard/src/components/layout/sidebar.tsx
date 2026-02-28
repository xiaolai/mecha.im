"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BoxIcon,
  NetworkIcon,
  ShieldCheckIcon,
  ScrollTextIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";

const navItems = [
  { href: "/", label: "CASAs", icon: BoxIcon },
  { href: "/mesh", label: "Mesh", icon: NetworkIcon },
  { href: "/acl", label: "ACL", icon: ShieldCheckIcon },
  { href: "/audit", label: "Audit", icon: ScrollTextIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

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
          <span className="text-sm font-semibold text-sidebar-foreground">mecha</span>
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
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
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
      </aside>
    </>
  );
}
