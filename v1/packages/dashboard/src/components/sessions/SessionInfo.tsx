"use client";

import { useCallback, useState } from "react";
import {
  ClockIcon,
  CopyIcon,
  HashIcon,
  FolderIcon,
  CpuIcon,
} from "lucide-react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";

export interface SessionDetailData {
  id: string;
  title: string;
  projectSlug: string;
  messageCount: number;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionInfoProps {
  detail: SessionDetailData;
  sessionId: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(diff)) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function SessionInfo({ detail, sessionId }: SessionInfoProps) {
  const [copied, setCopied] = useState(false);

  const copyId = useCallback(() => {
    navigator.clipboard.writeText(sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [sessionId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">
          {detail.title || "(untitled session)"}
        </h2>
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono text-muted-foreground">{sessionId}</code>
          <TooltipIconButton
            tooltip={copied ? "Copied!" : "Copy session ID"}
            className="size-5 p-0.5"
            onClick={copyId}
          >
            <CopyIcon className="size-3" />
          </TooltipIconButton>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <InfoCard
          icon={<HashIcon className="size-3.5" />}
          label="Messages"
          value={String(detail.messageCount)}
        />
        <InfoCard
          icon={<CpuIcon className="size-3.5" />}
          label="Model"
          value={detail.model ?? "(unknown)"}
        />
        <InfoCard
          icon={<FolderIcon className="size-3.5" />}
          label="Project"
          value={detail.projectSlug}
        />
        <InfoCard
          icon={<ClockIcon className="size-3.5" />}
          label="Created"
          value={timeAgo(detail.createdAt)}
        />
        <InfoCard
          icon={<ClockIcon className="size-3.5" />}
          label="Updated"
          value={timeAgo(detail.updatedAt)}
        />
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-sm font-semibold font-mono">{value}</div>
    </div>
  );
}
