"use client";

import Link from "next/link";
import { ArrowLeftIcon, SquareIcon, OctagonXIcon, MessageSquareIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SessionList } from "@/components/session-list";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useCasaAction } from "@/lib/use-casa-action";
import { stateStyles } from "@/lib/casa-styles";
import type { CasaInfo } from "./casa-card";

interface CasaDetailProps {
  name: string;
}

export function CasaDetail({ name }: CasaDetailProps) {
  const { data: casa, loading, error, refetch } = useFetch<CasaInfo>(
    `/api/casas/${encodeURIComponent(name)}`,
    { interval: 5000, deps: [name] },
  );

  const { acting, actionError, handleAction } = useCasaAction(name, refetch);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error || !casa) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Back to CASAs
        </Link>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? "CASA not found"}
        </div>
      </div>
    );
  }

  const style = stateStyles[casa.state];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Back to CASAs">
            <ArrowLeftIcon className="size-4" />
          </Link>
          <span className={cn("size-2.5 rounded-full", style.dot)} />
          <h1 className="text-lg font-semibold text-foreground">{casa.name}</h1>
          <Badge variant={style.badge}>{casa.state}</Badge>
        </div>
        {casa.state === "running" && (
          <div className="flex items-center gap-3">
            <Button variant="default" size="sm" asChild>
              <Link href={`/casa/${encodeURIComponent(name)}/chat`}>
                <MessageSquareIcon className="size-4" /> Chat
              </Link>
            </Button>
            <Button variant="outline" size="sm" disabled={acting} onClick={() => handleAction("stop")}>
              <SquareIcon className="size-4" /> Stop
            </Button>
            <TooltipIconButton
              tooltip="Force kill"
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive sm:size-8"
              disabled={acting}
              onClick={() => handleAction("kill")}
            >
              <OctagonXIcon className="size-4" />
            </TooltipIconButton>
          </div>
        )}
      </div>

      {/* Action error */}
      {actionError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Overview cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">PORT</div>
          <div className="text-sm font-semibold font-mono text-card-foreground">{casa.port ?? "—"}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">WORKSPACE</div>
          <div className="truncate text-sm font-mono text-card-foreground" title={casa.workspacePath}>
            {casa.workspacePath}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">STARTED</div>
          <div className="text-sm text-card-foreground">
            {casa.startedAt ? new Date(casa.startedAt).toLocaleString() : "—"}
          </div>
        </div>
      </div>

      {/* Tags */}
      {casa.tags && casa.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {casa.tags.map((tag) => (
            <Badge key={tag} variant="outline">{tag}</Badge>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions">
          <SessionList name={name} />
        </TabsContent>
        <TabsContent value="config">
          <div className="rounded-lg border border-border bg-card p-4">
            <pre className="text-xs font-mono text-card-foreground whitespace-pre-wrap">
              {JSON.stringify(casa, null, 2)}
            </pre>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
