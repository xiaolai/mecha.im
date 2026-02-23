"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ClockIcon, CopyIcon, MessageSquareIcon, MoreHorizontalIcon, PencilIcon, StarIcon, TrashIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Session } from "@/lib/store";

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  starred?: boolean;
  onClick: () => void;
  onRename: (sessionId: string, newTitle: string) => void;
  onStar: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const normalized = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z";
  const diff = Date.now() - new Date(normalized).getTime();
  if (Number.isNaN(diff)) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export function SessionItem({ session, isActive, starred, onClick, onRename, onStar, onDelete }: SessionItemProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    if (editing && inputRef.current) {
      committedRef.current = false;
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startRename = () => {
    setEditValue(session.customTitle ?? session.title);
    setEditing(true);
  };

  const commitRename = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = editValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== (session.customTitle ?? session.title)) {
      onRename(session.id, trimmed);
    }
  }, [editValue, session.title, session.customTitle, session.id, onRename]);

  const cancelRename = () => {
    committedRef.current = true;
    setEditing(false);
  };

  const displayTitle = (session.customTitle ?? session.title) || session.id.slice(0, 8);

  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 pl-6 text-sm transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent",
      )}
    >
      {editing ? (
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") cancelRename();
            }}
            onBlur={commitRename}
            maxLength={200}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-inherit p-0"
          />
        </div>
      ) : (
        <>
          <button
            onClick={onClick}
            className="flex flex-1 items-center gap-2 min-w-0 bg-transparent border-none p-0 text-left cursor-pointer text-inherit"
          >
            <span className="flex-1 break-words min-w-0" title={displayTitle}>
              {displayTitle}
            </span>
            {starred && (
              <StarIcon className="size-3 shrink-0 fill-current text-muted-foreground" />
            )}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Session actions"
                className={cn("shrink-0", !isActive && "sm:opacity-0 sm:group-hover:opacity-100")}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              >
                <MoreHorizontalIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 border-border shadow-md">
              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(session.id).catch(() => { /* clipboard unavailable in insecure context */ }); }}>
                <CopyIcon className="size-4" />
                Copy Session ID
              </DropdownMenuItem>
              <DropdownMenuItem onClick={startRename}>
                <PencilIcon className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStar(session.id)}>
                <StarIcon className={cn("size-4", starred && "fill-current")} />
                {starred ? "Unstar" : "Star"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(session.id)}
                variant="destructive"
              >
                <TrashIcon className="size-4" />
                Delete
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <MessageSquareIcon className="size-4" />
                  {session.messageCount}
                </span>
                {session.updatedAt && (
                  <span className="flex items-center gap-2">
                    <ClockIcon className="size-4" />
                    {timeAgo(session.updatedAt)}
                  </span>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}
