import { CheckIcon, Loader2Icon, AlertTriangleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { humanizeProfileName, isExpired, authTypeIcon } from "@/lib/auth-utils";

/** Shape of an auth profile entry returned by the API. */
export interface AuthProfile {
  name: string;
  type: "oauth" | "api-key";
  label?: string;
  isDefault: boolean;
  tags?: string[];
  expiresAt?: number | null;
}

/** Renders the selectable list of auth profiles inside the switcher popover. */
export function ProfileList({
  profiles,
  profilesLoading,
  profilesError,
  currentAuth,
  hasProfiles,
  switching,
  error,
  onSelect,
  onRetry,
}: {
  profiles: AuthProfile[] | null;
  profilesLoading: boolean;
  profilesError: string | null;
  currentAuth: string | undefined;
  hasProfiles: boolean | null;
  switching: boolean;
  error: string | null;
  onSelect: (name: string | null) => void;
  onRetry: () => void;
}) {
  if (profilesLoading && !profiles) {
    return (
      <div className="flex flex-col gap-1 p-1">
        <Skeleton className="h-8 w-full rounded-sm" />
        <Skeleton className="h-8 w-full rounded-sm" />
        <Skeleton className="h-8 w-full rounded-sm" />
      </div>
    );
  }

  if (profilesError) {
    return (
      <div className="flex flex-col items-center gap-2 p-3">
        <span className="text-xs text-destructive">Failed to load profiles</span>
        <Button variant="outline" size="xs" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  if (!hasProfiles && !currentAuth) {
    return (
      <div className="p-3 text-center">
        <span className="text-xs text-muted-foreground">
          No auth profiles.{" "}
          <span className="font-mono">mecha auth add</span> to create one.
        </span>
      </div>
    );
  }

  return (
    <>
      {profiles?.map((p) => {
        const expired = isExpired(p.expiresAt);
        const isSelected = currentAuth ? p.name === currentAuth : p.isDefault;

        const item = (
          <button
            key={p.name}
            type="button"
            onClick={() => !expired && onSelect(p.name)}
            disabled={switching || expired}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 min-h-11 sm:min-h-0 text-sm",
              expired
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer hover:bg-accent hover:text-accent-foreground",
              switching && "pointer-events-none",
            )}
          >
            <span className="size-4 flex shrink-0 items-center justify-center">
              {isSelected && <CheckIcon className="size-3.5 text-primary" />}
            </span>
            {authTypeIcon(p.type)}
            <span className="truncate">{humanizeProfileName(p.name)}</span>
            {p.isDefault && (
              <span className="text-xs text-muted-foreground shrink-0">default</span>
            )}
            {expired && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-warning shrink-0">
                <AlertTriangleIcon className="size-3" /> expired
              </span>
            )}
            {!expired && (
              <Badge variant="outline" className="ml-auto text-xs shrink-0">{p.type}</Badge>
            )}
          </button>
        );

        if (expired) {
          return (
            <Tooltip key={p.name}>
              <TooltipTrigger asChild>
                <span className="block">{item}</span>
              </TooltipTrigger>
              <TooltipContent>Token expired — renew with <span className="font-mono">mecha auth renew</span></TooltipContent>
            </Tooltip>
          );
        }

        return item;
      })}

      {currentAuth && (
        <>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => onSelect(null)}
            disabled={switching}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 min-h-11 sm:min-h-0 text-sm cursor-pointer",
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              switching && "opacity-50 pointer-events-none",
            )}
          >
            <span className="size-4" />
            <span>Use default profile</span>
          </button>
        </>
      )}

      {error && (
        <div className="mt-1 border-t border-border pt-2 px-2 pb-1">
          <span className="text-xs text-destructive">{error}</span>
        </div>
      )}
    </>
  );
}

/** Renders a confirmation panel asking whether to switch auth and restart the bot. */
export function ConfirmView({
  label,
  switching,
  error,
  onSwitchRestart,
  onJustSave,
}: {
  label: string;
  switching: boolean;
  error: string | null;
  onSwitchRestart: () => void;
  onJustSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-sm font-medium text-foreground">
        Switch to &ldquo;{label}&rdquo;?
      </div>
      <div className="text-xs text-muted-foreground">
        bot needs a restart to apply.
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={switching} onClick={onSwitchRestart} className="min-h-11 sm:min-h-0 w-full sm:w-auto">
          {switching && <Loader2Icon className="size-3.5 animate-spin" />}
          Switch & Restart
        </Button>
        <Button variant="ghost" size="sm" disabled={switching} onClick={onJustSave} className="min-h-11 sm:min-h-0 w-full sm:w-auto">
          Just Save
        </Button>
      </div>
    </div>
  );
}

/** Renders a warning panel for force-restarting a bot with active sessions. */
export function ForceConfirmView({
  switching,
  error,
  onForce,
  onJustSave,
}: {
  switching: boolean;
  error: string | null;
  onForce: () => void;
  onJustSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-warning">
        <AlertTriangleIcon className="size-4 shrink-0" />
        Active sessions running
      </div>
      <div className="text-xs text-muted-foreground">
        Force restart will interrupt them.
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex items-center gap-2">
        <Button variant="destructive" size="sm" disabled={switching} onClick={onForce} className="min-h-11 sm:min-h-0 w-full sm:w-auto">
          {switching && <Loader2Icon className="size-3.5 animate-spin" />}
          Force Restart
        </Button>
        <Button variant="ghost" size="sm" disabled={switching} onClick={onJustSave} className="min-h-11 sm:min-h-0 w-full sm:w-auto">
          Just Save
        </Button>
      </div>
    </div>
  );
}
