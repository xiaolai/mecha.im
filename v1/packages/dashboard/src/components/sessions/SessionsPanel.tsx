"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Skeleton } from "@/components/ui/skeleton";
import { SessionItem } from "./SessionItem";
import { SessionSearch } from "./SessionSearch";
import { SessionTabs } from "./SessionTabs";
import { useDashboardStore, type Session } from "@/lib/store";
import type { SessionSummary, SessionMeta } from "@mecha/core";

interface SessionListResponse {
  sessions: SessionSummary[];
  meta: Record<string, SessionMeta>;
}

function toStoreSession(s: SessionSummary, meta?: SessionMeta): Session {
  return {
    id: s.id,
    projectSlug: s.projectSlug,
    title: s.title,
    messageCount: s.messageCount,
    model: s.model,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : String(s.updatedAt),
    customTitle: meta?.customTitle,
    starred: meta?.starred,
  };
}

interface SlugGroup {
  slug: string;
  sessions: Session[];
}

function groupBySlug(sessions: Session[]): SlugGroup[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const arr = map.get(s.projectSlug) ?? [];
    arr.push(s);
    map.set(s.projectSlug, arr);
  }
  const groups: SlugGroup[] = [];
  for (const [slug, slugSessions] of map) {
    groups.push({ slug, sessions: slugSessions });
  }
  return groups;
}

export function SessionsPanel() {
  const selectedMechaId = useDashboardStore((s) => s.selectedMechaId);
  const mechas = useDashboardStore((s) => s.mechas);
  const sessions = useDashboardStore((s) => s.sessions);
  const setSessions = useDashboardStore((s) => s.setSessions);
  const addSession = useDashboardStore((s) => s.addSession);
  const removeSession = useDashboardStore((s) => s.removeSession);
  const updateSession = useDashboardStore((s) => s.updateSession);
  const selectedSessionId = useDashboardStore((s) => s.selectedSessionId);
  const setSelectedSessionId = useDashboardStore((s) => s.setSelectedSessionId);
  const activeTab = useDashboardStore((s) => s.activeTab);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const searchQuery = useDashboardStore((s) => s.searchQuery);
  const setSearchQuery = useDashboardStore((s) => s.setSearchQuery);

  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [collapsedSlugs, setCollapsedSlugs] = useState<Set<string>>(new Set());

  const selectedMecha = mechas.find((m) => m.id === selectedMechaId);
  const mechaSessions = selectedMechaId ? sessions[selectedMechaId] ?? [] : [];
  const isRunning = selectedMecha?.state === "running";
  const nodeParam = selectedMecha?.node && selectedMecha.node !== "local"
    ? `?node=${encodeURIComponent(selectedMecha.node)}`
    : "";

  const filteredSessions = searchQuery
    ? mechaSessions.filter(
        (s) =>
          (s.customTitle ?? s.title).toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.id.includes(searchQuery),
      )
    : mechaSessions;

  const slugGroups = groupBySlug(filteredSessions);

  const toggleSlugCollapsed = useCallback((slug: string) => {
    setCollapsedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const createSession = useCallback(async () => {
    if (!selectedMechaId) return;
    try {
      const res = await fetch(`/api/mechas/${selectedMechaId}/sessions${nodeParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const session = await res.json();
        addSession(selectedMechaId, {
          id: session.sessionId ?? session.id,
          projectSlug: session.projectSlug ?? "",
          title: session.title ?? "(untitled)",
          messageCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        setSelectedSessionId(session.sessionId ?? session.id);
      }
    } catch { /* ignore */ }
  }, [selectedMechaId, nodeParam, addSession, setSelectedSessionId]);

  const handleRename = useCallback(async (sessionId: string, title: string) => {
    if (!selectedMechaId) return;
    try {
      const res = await fetch(`/api/mechas/${selectedMechaId}/sessions/${sessionId}${nodeParam}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        updateSession(selectedMechaId, sessionId, { customTitle: title });
      }
    } catch { /* network error — UI stays unchanged */ }
  }, [selectedMechaId, nodeParam, updateSession]);

  const handleDelete = useCallback(async () => {
    if (!selectedMechaId || !confirmDelete) return;
    const sessionId = confirmDelete;
    setConfirmDelete(null);
    try {
      const res = await fetch(`/api/mechas/${selectedMechaId}/sessions/${sessionId}${nodeParam}`, {
        method: "DELETE",
      });
      if (res.ok) {
        removeSession(selectedMechaId, sessionId);

        if (selectedSessionId === sessionId) {
          const remaining = mechaSessions.filter((s) => s.id !== sessionId);
          if (remaining.length > 0) {
            setSelectedSessionId(remaining[0].id);
          } else if (isRunning) {
            createSession();
          } else {
            setSelectedSessionId(null);
          }
        }
      }
    } catch { /* network error — no state change */ }
  }, [selectedMechaId, nodeParam, confirmDelete, removeSession, selectedSessionId, mechaSessions, setSelectedSessionId, createSession]);

  const handleStar = useCallback(async (sessionId: string) => {
    if (!selectedMechaId) return;
    const session = mechaSessions.find((s) => s.id === sessionId);
    const newStarred = !(session?.starred);
    updateSession(selectedMechaId, sessionId, { starred: newStarred });
    // Persist to server-side metadata
    try {
      await fetch(`/api/mechas/${selectedMechaId}/sessions/${sessionId}${nodeParam}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: newStarred }),
      });
    } catch { /* optimistic update already applied */ }
  }, [selectedMechaId, nodeParam, mechaSessions, updateSession]);

  useEffect(() => {
    if (!selectedMechaId) return;
    const mechaId = selectedMechaId;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/mechas/${mechaId}/sessions${nodeParam}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!res.ok) return;
        const data = (await res.json()) as SessionListResponse;
        if (controller.signal.aborted) return;

        const storeSessions = data.sessions.map((s) =>
          toStoreSession(s, data.meta[s.id]),
        );
        setSessions(mechaId, storeSessions);

        if (storeSessions.length > 0) {
          setSelectedSessionId(storeSessions[0].id);
        } else if (isRunning) {
          // No sessions — auto-create one
          const createRes = await fetch(`/api/mechas/${mechaId}/sessions${nodeParam}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            signal: controller.signal,
          });
          if (controller.signal.aborted || !createRes.ok) return;
          const session = await createRes.json();
          addSession(mechaId, {
            id: session.sessionId ?? session.id,
            projectSlug: session.projectSlug ?? "",
            title: session.title ?? "(untitled)",
            messageCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          setSelectedSessionId(session.sessionId ?? session.id);
        }
      } catch {
        // aborted or network error — ignore
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [selectedMechaId, nodeParam, isRunning, setSessions, addSession, setSelectedSessionId]);

  if (!selectedMechaId) {
    return (
      <div className="flex h-full w-full flex-col bg-sidebar">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-sm font-medium text-sidebar-foreground">Sessions</span>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          Select a mecha from the rail to view sessions
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-sidebar-foreground truncate">
            {selectedMecha?.name || selectedMechaId}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {selectedMecha?.path || ""}
          </span>
        </div>
      </div>

      {/* Search */}
      {mechaSessions.length > 3 && (
        <div className="pt-2">
          <SessionSearch value={searchQuery} onChange={setSearchQuery} />
        </div>
      )}

      {/* New Chat */}
      {isRunning && (
        <div className="px-2 pb-1">
          <button
            onClick={createSession}
            className="flex h-8 w-full items-center gap-2 rounded-md bg-muted px-2 text-sm text-sidebar-foreground transition-colors hover:bg-accent"
          >
            <PlusIcon className="size-4" />
            New Chat
          </button>
        </div>
      )}

      {/* Sessions list — file explorer tree */}
      <ScrollArea className="flex-1 min-h-0 px-2 py-1">
        {loading ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : mechaSessions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <span className="text-xs text-muted-foreground">No sessions yet</span>
            {isRunning && (
              <Button variant="outline" size="sm" onClick={createSession} className="w-full sm:w-auto">
                Start a session
              </Button>
            )}
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground text-center">
            No matching sessions
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {slugGroups.map((group) => (
              <div key={group.slug}>
                {/* Project slug folder header */}
                <button
                  onClick={() => toggleSlugCollapsed(group.slug)}
                  className="flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <ChevronRightIcon
                    className={`size-3 transition-transform ${collapsedSlugs.has(group.slug) ? "" : "rotate-90"}`}
                  />
                  {group.slug}
                  <span className="ml-auto text-xs opacity-60">{group.sessions.length}</span>
                </button>
                {/* Session leaves */}
                {!collapsedSlugs.has(group.slug) && group.sessions.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={selectedSessionId === s.id}
                    starred={s.starred ?? false}
                    onClick={() => setSelectedSessionId(s.id)}
                    onRename={handleRename}
                    onDelete={(sid) => setConfirmDelete(sid)}
                    onStar={handleStar}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Tab switcher */}
      <SessionTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Delete confirmation dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Session</DialogTitle>
            <DialogDescription>
              This will permanently delete the session and all its messages. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
