"use client";

import { useDashboardStore } from "@/lib/store";
import { PlusIcon, BoxIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function DashboardHome() {
  const mechas = useDashboardStore((s) => s.mechas);
  const selectedMechaId = useDashboardStore((s) => s.selectedMechaId);

  // If we have mechas but none selected, show prompt
  if (mechas.length > 0 && !selectedMechaId) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <BoxIcon className="size-12 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold mb-1">Select a Mecha</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Click on a mecha icon in the sidebar to view its sessions and interact with it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No mechas at all
  if (mechas.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <BoxIcon className="size-12 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold mb-1">No Mechas Yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Create your first mecha to get started, or use <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">mecha up &lt;path&gt;</code> from the CLI.
            </p>
            <Button asChild>
              <Link href="/create">
                <PlusIcon className="size-4 mr-1.5" />
                New Mecha
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Mecha selected - show the active tab content
  return <MechaContent />;
}

function MechaContent() {
  const activeTab = useDashboardStore((s) => s.activeTab);
  const selectedMechaId = useDashboardStore((s) => s.selectedMechaId);
  const selectedSessionId = useDashboardStore((s) => s.selectedSessionId);
  const mechas = useDashboardStore((s) => s.mechas);

  if (!selectedMechaId) return null;

  const mecha = mechas.find((m) => m.id === selectedMechaId);
  if (!mecha) return null;

  const isRunning = mecha.state === "running";

  // Lazy import the tab content components
  switch (activeTab) {
    case "chat":
      return <ChatTab mechaId={selectedMechaId} sessionId={selectedSessionId} isRunning={isRunning} node={mecha.node} />;
    case "overview":
      return <OverviewTab mechaId={selectedMechaId} sessionId={selectedSessionId} isRunning={isRunning} node={mecha.node} />;
    case "terminal":
      return <TerminalTab mechaId={selectedMechaId} isRunning={isRunning} />;
    case "inspect":
      return <InspectTab mechaId={selectedMechaId} />;
    default:
      return null;
  }
}

// Inline tab components that use existing components

import { MechaChat } from "@/components/MechaChat";
import { MechaOverview } from "@/components/overview/MechaOverview";
import { SessionInfo, type SessionDetailData } from "@/components/sessions/SessionInfo";
import { SessionConfigEditor } from "@/components/sessions/SessionConfigEditor";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { InspectPanel } from "@/components/inspect/InspectPanel";
import { useDashboardStore as useStore } from "@/lib/store";
import { useCallback, useEffect, useState } from "react";

function ChatTab({ mechaId, sessionId, isRunning, node }: { mechaId: string; sessionId: string | null; isRunning: boolean; node?: string }) {
  const setSessions = useStore((s) => s.setSessions);
  const nodeParam = node && node !== "local"
    ? `?node=${encodeURIComponent(node)}`
    : "";

  const handleStreamComplete = useCallback(async () => {
    try {
      const res = await fetch(`/api/mechas/${mechaId}/sessions${nodeParam}`);
      if (res.ok) {
        const data = await res.json();
        const sessions = data.sessions ?? [];
        const meta = data.meta ?? {};
        setSessions(mechaId, sessions.map((s: Record<string, unknown>) => ({
          id: s.id,
          projectSlug: (s.projectSlug as string) ?? "",
          title: (s.title as string) ?? "(untitled)",
          messageCount: (s.messageCount as number) ?? 0,
          model: s.model as string | undefined,
          createdAt: s.createdAt instanceof Date ? (s.createdAt as Date).toISOString() : String(s.createdAt),
          updatedAt: s.updatedAt instanceof Date ? (s.updatedAt as Date).toISOString() : String(s.updatedAt),
          customTitle: (meta[s.id as string] as Record<string, unknown> | undefined)?.customTitle as string | undefined,
          starred: (meta[s.id as string] as Record<string, unknown> | undefined)?.starred as boolean | undefined,
        })));
      }
    } catch { /* ignore */ }
  }, [mechaId, nodeParam, setSessions]);

  if (!isRunning) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          Start the mecha to chat with it.
        </p>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          Creating session...
        </p>
      </div>
    );
  }

  return (
    <div className="h-full">
      <MechaChat
        key={sessionId}
        mechaId={mechaId}
        sessionId={sessionId}
        node={node}
        onStreamComplete={handleStreamComplete}
      />
    </div>
  );
}

function OverviewTab({ mechaId, sessionId, isRunning, node }: { mechaId: string; sessionId: string | null; isRunning: boolean; node?: string }) {
  const [detail, setDetail] = useState<SessionDetailData | null>(null);
  const [error, setError] = useState("");
  const nodeParam = node && node !== "local"
    ? `?node=${encodeURIComponent(node)}`
    : "";

  const loadDetail = useCallback(async () => {
    if (!sessionId) return;
    setDetail(null);
    setError("");
    try {
      const res = await fetch(`/api/mechas/${mechaId}/sessions/${sessionId}${nodeParam}`);
      if (!res.ok) {
        setError(`Failed to load session (${res.status})`);
        return;
      }
      setDetail(await res.json());
    } catch {
      setError("Failed to load session");
    }
  }, [mechaId, sessionId, nodeParam]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  if (sessionId) {
    if (error) {
      return <p className="text-sm text-destructive p-4 md:p-6">{error}</p>;
    }
    if (!detail) {
      return <p className="text-sm text-muted-foreground p-4 md:p-6">Loading session...</p>;
    }
    return (
      <div className="p-4 md:p-6 max-w-3xl space-y-6">
        <SessionInfo detail={detail} sessionId={sessionId} />
        {isRunning && (
          <SessionConfigEditor
            mechaId={mechaId}
            sessionId={sessionId}
            initialConfig={{}}
            onSaved={loadDetail}
          />
        )}
      </div>
    );
  }
  return <MechaOverview mechaId={mechaId} isRunning={isRunning} />;
}

function TerminalTab({ mechaId, isRunning }: { mechaId: string; isRunning: boolean }) {
  return <TerminalPanel mechaId={mechaId} isRunning={isRunning} />;
}

function InspectTab({ mechaId }: { mechaId: string }) {
  return <InspectPanel mechaId={mechaId} />;
}
