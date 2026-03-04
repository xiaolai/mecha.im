import { useState, useCallback, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  PlayIcon, RefreshCwIcon, SquareIcon, OctagonXIcon,
  KeyRoundIcon, ShieldCheckIcon, CopyIcon, CheckIcon, ClockIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { stateStyles } from "@/lib/bot-styles";
import { useBotAction } from "@/lib/use-bot-action";
import { humanizeProfileName } from "@/lib/auth-utils";
import { BusyWarningBanner } from "@/components/busy-warning-banner";
import { ConfirmActionBanner } from "@/components/confirm-action-banner";

export interface BotInfo {
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

interface BotCardProps {
  bot: BotInfo;
}

/** Tiny inline copy button — shows check icon briefly after copying. */
function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* clipboard denied — no feedback */ });
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

export function BotCard({ bot }: BotCardProps) {
  const style = stateStyles[bot.state] ?? stateStyles.error;
  const { acting, actionError, busyWarning, pendingConfirm, handleAction, confirmAction, dismissConfirm, confirmForce, dismissBusy } = useBotAction(bot.name, undefined, bot.node);

  return (
    <div className="relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50">
      <Link
        to={`/bot/${encodeURIComponent(bot.name)}${bot.node && bot.node !== "local" ? `?node=${encodeURIComponent(bot.node)}` : ""}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`View ${bot.name}`}
      />

      {/* Row 1: name @ node · status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("size-2 shrink-0 rounded-full", style.dot)} />
          <span className="text-sm font-semibold text-card-foreground truncate">{bot.name}</span>
          {bot.node && (
            <span className="text-xs text-muted-foreground font-mono shrink-0">@ {bot.node}</span>
          )}
        </div>
        <Badge variant={style.badge} className="shrink-0">{bot.state}</Badge>
      </div>

      {/* Row 2: port, auth key, homeDir — each copyable */}
      <div className="flex flex-col gap-1 text-xs">
        {bot.port != null && (
          <DetailRow label="Port" value={String(bot.port)} />
        )}
        {bot.auth && (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-muted-foreground shrink-0 inline-flex items-center gap-1">
              {bot.authType === "oauth" ? <ShieldCheckIcon className="size-3" /> : <KeyRoundIcon className="size-3" />}
              Key
            </span>
            <span className="font-mono truncate">{humanizeProfileName(bot.auth)}</span>
          </span>
        )}
        {bot.homeDir && (
          <DetailRow label="Home" value={bot.homeDir} />
        )}
      </div>

      {/* Row 3: hostname, IP */}
      {(bot.hostname || bot.lanIp || bot.tailscaleIp) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {bot.hostname && (
            <span className="font-mono truncate">{bot.hostname}</span>
          )}
          {bot.tailscaleIp && (
            <span className="inline-flex items-center gap-1">
              <span className="font-mono">{bot.tailscaleIp}</span>
              <CopyBtn value={bot.tailscaleIp} />
            </span>
          )}
          {bot.lanIp && (
            <span className="inline-flex items-center gap-1">
              <span className="font-mono">{bot.lanIp}</span>
              <CopyBtn value={bot.lanIp} />
            </span>
          )}
        </div>
      )}

      {/* Row 4: running time + cost */}
      {bot.state === "running" && bot.startedAt && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3" />
            {formatUptime(bot.startedAt)}
          </span>
          {bot.costToday != null && bot.costToday > 0 && (
            <span>{bot.costToday < 0.01 ? "<$0.01" : `$${bot.costToday.toFixed(2)}`} today</span>
          )}
        </div>
      )}

      {/* Tags */}
      {bot.tags && bot.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {bot.tags.map((tag) => (
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

      {/* Confirm action */}
      {pendingConfirm && (
        <ConfirmActionBanner
          action={pendingConfirm}
          name={bot.name}
          onConfirm={confirmAction}
          onCancel={dismissConfirm}
          acting={acting}
        />
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
        {bot.state === "stopped" && (
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
        {bot.state === "running" && (
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
