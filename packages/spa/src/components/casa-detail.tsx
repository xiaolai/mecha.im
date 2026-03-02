import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon, PlayIcon, RefreshCwIcon, SquareIcon, OctagonXIcon, TerminalSquareIcon } from "lucide-react";
import { AuthSwitcher } from "@/components/auth-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SessionList } from "@/components/session-list";
import { BusyWarningBanner } from "@/components/busy-warning-banner";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useCasaAction } from "@/lib/use-casa-action";
import { stateStyles } from "@/lib/casa-styles";
import { shortModelName, formatCost } from "@/lib/format";
import type { CasaInfo } from "./casa-card";

interface CasaDetailProps {
  name: string;
  node?: string;
}

export function CasaDetail({ name, node }: CasaDetailProps) {
  const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
  const { data: casa, loading, error, refetch } = useFetch<CasaInfo>(
    `/casas/${encodeURIComponent(name)}/status${nodeQuery}`,
    { interval: 5000, deps: [name, node] },
  );

  const { acting, actionError, busyWarning, handleAction, confirmForce, dismissBusy } = useCasaAction(name, refetch, node);
  const [restartPending, setRestartPending] = useState(false);
  const prevState = useRef(casa?.state);
  const prevStartedAt = useRef(casa?.startedAt);
  useEffect(() => {
    if (!casa) return;
    const stateChanged = prevState.current !== casa.state;
    const restarted = prevStartedAt.current !== casa.startedAt && casa.state === "running";
    if (stateChanged && prevState.current === "running" && casa.state !== "running") setRestartPending(false);
    if (restarted) setRestartPending(false);
    prevState.current = casa.state;
    prevStartedAt.current = casa.startedAt;
  }, [casa?.state, casa?.startedAt]);

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
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Back to CASAs
        </Link>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? "CASA not found"}
        </div>
      </div>
    );
  }

  const style = stateStyles[casa.state] ?? stateStyles.error;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Back to CASAs">
            <ArrowLeftIcon className="size-4" />
          </Link>
          <span className={cn("size-2.5 rounded-full", style.dot)} />
          <h1 className="text-lg font-semibold text-foreground">{casa.name}</h1>
          <Badge variant={style.badge}>{casa.state}</Badge>
          {node && node !== "local" && (
            <span className="text-xs text-muted-foreground font-mono">@ {node}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {casa.state === "stopped" && (
            <Button
              variant="outline"
              size="sm"
              className="text-success border-success"
              disabled={acting}
              onClick={() => handleAction("start")}
            >
              <PlayIcon className="size-4" /> Start
            </Button>
          )}
          {casa.state === "running" && (
            <>
              <Button variant="default" size="sm" asChild>
                <Link to={`/casa/${encodeURIComponent(name)}/terminal${nodeQuery}`}>
                  <TerminalSquareIcon className="size-4" /> Terminal
                </Link>
              </Button>
              <Button variant="outline" size="sm" disabled={acting} onClick={() => handleAction("restart")}>
                <RefreshCwIcon className="size-4" /> Restart
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
            </>
          )}
        </div>
      </div>

      {/* Action error */}
      {actionError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Busy warning */}
      {busyWarning && (
        <BusyWarningBanner
          warning={busyWarning}
          onConfirm={confirmForce}
          onCancel={dismissBusy}
          acting={acting}
        />
      )}

      {/* Restart pending after auth change */}
      {restartPending && casa.state === "running" && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-foreground font-medium">Auth profile changed. Restart to apply.</span>
            <Button variant="outline" size="xs" onClick={() => handleAction("restart")}>
              Restart Now
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setRestartPending(false)}>
              Later
            </Button>
          </div>
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
            {casa.workspacePath ?? "—"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">STARTED</div>
          <div className="text-sm text-card-foreground">
            {(() => {
              if (!casa.startedAt) return "—";
              const d = new Date(casa.startedAt);
              return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
            })()}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">MODEL</div>
          <div className="text-sm font-mono text-card-foreground">
            {casa.model ? shortModelName(casa.model) : "—"}
          </div>
        </div>
        <AuthSwitcher
          casaName={name}
          currentAuth={casa.auth}
          currentAuthType={casa.authType}
          casaState={casa.state}
          node={node}
          onSwitched={refetch}
          onRestartNeeded={() => setRestartPending(true)}
        />
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">COST TODAY</div>
          <div className="text-sm font-semibold text-card-foreground">
            {casa.costToday != null ? formatCost(casa.costToday) : "—"}
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
          <SessionList name={name} node={node} />
        </TabsContent>
        <TabsContent value="config">
          <CasaConfigView casa={casa} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CasaConfigView({ casa }: { casa: CasaInfo }) {
  const json = useMemo(() => JSON.stringify(casa, null, 2), [casa]);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <pre className="text-xs font-mono text-card-foreground whitespace-pre-wrap">
        {json}
      </pre>
    </div>
  );
}
