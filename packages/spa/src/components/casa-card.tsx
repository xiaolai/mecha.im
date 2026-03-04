import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  PlayIcon, RefreshCwIcon, SquareIcon, OctagonXIcon,
  KeyRoundIcon, ShieldCheckIcon, CopyIcon, CheckIcon, ClockIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { stateStyles } from "@/lib/casa-styles";
import { useCasaAction } from "@/lib/use-casa-action";
import { humanizeProfileName } from "@/lib/auth-utils";
import { BusyWarningBanner } from "@/components/busy-warning-banner";

export interface CasaInfo {
  name: string;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath?: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number;
  tags?: string[];
  node?: string;
  hostname?: string;
  lanIp?: string;
  tailscaleIp?: string;
  homeDir?: string;
  model?: string;
  sandboxMode?: string;
  permissionMode?: string;
  auth?: string;
  authType?: "oauth" | "api-key";
  costToday?: number;
}

interface CasaCardProps {
  casa: CasaInfo;
}

/** Tiny inline copy button — shows check icon briefly after copying. */
function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="relative z-10 inline-flex items-center p-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
      aria-label={`Copy ${value}`}
    >
      {copied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
    </button>
  );
}

/** Format duration from ISO date to now (e.g. "2h 15m", "3d 4h") */
function formatUptime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
}

/** A copyable mono-text detail row */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono truncate">{value}</span>
      <CopyBtn value={value} />
    </span>
  );
}

export function CasaCard({ casa }: CasaCardProps) {
  const style = stateStyles[casa.state] ?? stateStyles.error;
  const { acting, actionError, busyWarning, handleAction, confirmForce, dismissBusy } = useCasaAction(casa.name, undefined, casa.node);

  return (
    <div className="relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50">
      <Link
        to={`/casa/${encodeURIComponent(casa.name)}${casa.node && casa.node !== "local" ? `?node=${encodeURIComponent(casa.node)}` : ""}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`View ${casa.name}`}
      />

      {/* Row 1: name @ node · status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("size-2 shrink-0 rounded-full", style.dot)} />
          <span className="text-sm font-semibold text-card-foreground truncate">{casa.name}</span>
          {casa.node && (
            <span className="text-xs text-muted-foreground font-mono shrink-0">@ {casa.node}</span>
          )}
        </div>
        <Badge variant={style.badge} className="shrink-0">{casa.state}</Badge>
      </div>

      {/* Row 2: port, auth key, homeDir — each copyable */}
      <div className="flex flex-col gap-1 text-xs">
        {casa.port != null && (
          <DetailRow label="Port" value={String(casa.port)} />
        )}
        {casa.auth && (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-muted-foreground shrink-0 inline-flex items-center gap-1">
              {casa.authType === "oauth" ? <ShieldCheckIcon className="size-3" /> : <KeyRoundIcon className="size-3" />}
              Key
            </span>
            <span className="font-mono truncate">{humanizeProfileName(casa.auth)}</span>
          </span>
        )}
        {casa.homeDir && (
          <DetailRow label="Home" value={casa.homeDir} />
        )}
      </div>

      {/* Row 3: hostname, IP */}
      {(casa.hostname || casa.lanIp || casa.tailscaleIp) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {casa.hostname && (
            <span className="font-mono truncate">{casa.hostname}</span>
          )}
          {casa.tailscaleIp && (
            <span className="inline-flex items-center gap-1">
              <span className="font-mono">{casa.tailscaleIp}</span>
              <CopyBtn value={casa.tailscaleIp} />
            </span>
          )}
          {casa.lanIp && (
            <span className="inline-flex items-center gap-1">
              <span className="font-mono">{casa.lanIp}</span>
              <CopyBtn value={casa.lanIp} />
            </span>
          )}
        </div>
      )}

      {/* Row 4: running time + cost */}
      {casa.state === "running" && casa.startedAt && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3" />
            {formatUptime(casa.startedAt)}
          </span>
          {casa.costToday != null && casa.costToday > 0 && (
            <span>{casa.costToday < 0.01 ? "<$0.01" : `$${casa.costToday.toFixed(2)}`} today</span>
          )}
        </div>
      )}

      {/* Tags */}
      {casa.tags && casa.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {casa.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="text-xs text-destructive">{actionError}</div>
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

      {/* Actions */}
      <div className="relative z-10 flex items-center gap-3 border-t border-border pt-2">
        {casa.state === "stopped" && (
          <TooltipIconButton
            tooltip="Start"
            variant="outline"
            size="icon"
            className="text-success hover:text-success sm:size-8"
            disabled={acting}
            onClick={() => handleAction("start")}
          >
            <PlayIcon className="size-4" />
          </TooltipIconButton>
        )}
        {casa.state === "running" && (
          <>
            <TooltipIconButton
              tooltip="Restart"
              variant="outline"
              size="icon"
              className="sm:size-8"
              disabled={acting}
              onClick={() => handleAction("restart")}
            >
              <RefreshCwIcon className="size-4" />
            </TooltipIconButton>
            <TooltipIconButton
              tooltip="Stop"
              variant="outline"
              size="icon"
              className="sm:size-8"
              disabled={acting}
              onClick={() => handleAction("stop")}
            >
              <SquareIcon className="size-4" />
            </TooltipIconButton>
            <TooltipIconButton
              tooltip="Kill"
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
  );
}
