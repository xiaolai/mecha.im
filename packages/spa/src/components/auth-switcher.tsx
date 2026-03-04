import { useState, useCallback } from "react";
import { ChevronDownIcon, CheckIcon, Loader2Icon, AlertTriangleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";
import { humanizeProfileName, isExpired, authTypeIcon } from "@/lib/auth-utils";

interface AuthProfile {
  name: string;
  type: "oauth" | "api-key";
  label?: string;
  isDefault: boolean;
  tags?: string[];
  expiresAt?: number | null;
}

interface AuthSwitcherProps {
  botName: string;
  currentAuth: string | undefined;
  currentAuthType: string | undefined;
  botState: string;
  node?: string;
  onSwitched: () => void;
}

/**
 * State machine phases:
 *   list → (select profile) →
 *     stopped bot:  → switching → success/error → idle
 *     running bot:  → confirm → switching → success/error → idle
 *     409 BOT_BUSY: → confirm-force → switching → success/error → idle
 */
type SwitcherPhase = "list" | "confirm" | "confirm-force";

export function AuthSwitcher({ botName, currentAuth, currentAuthType, botState, node, onSwitched }: AuthSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<SwitcherPhase>("list");
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingProfile, setPendingProfile] = useState<string | null>(null);
  const { authHeaders, logout } = useAuth();

  const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";

  const { data: profiles, loading: profilesLoading, error: profilesError, refetch: refetchProfiles } = useFetch<AuthProfile[]>(
    `/auth/profiles${nodeQuery}`,
    { deps: [node] },
  );

  const resetState = useCallback(() => {
    setPhase("list");
    setError(null);
    setPendingProfile(null);
    setSwitching(false);
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) resetState();
  }, [resetState]);

  const patchConfig = useCallback(async (profileName: string | null, restart: boolean, force: boolean) => {
    setSwitching(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { auth: profileName };
      if (restart) body.restart = true;
      if (force) body.force = true;

      const res = await fetch(`/bots/${encodeURIComponent(botName)}/config${nodeQuery}`, {
        method: "PATCH",
        headers: { ...authHeaders, "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        setSwitching(false);
        logout();
        return;
      }

      const data = await res.json().catch(() => ({ error: "Failed to switch auth" }));

      if (res.status === 409 && data.code === "BOT_BUSY") {
        setPhase("confirm-force");
        setSwitching(false);
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "Failed to switch auth");
        setSwitching(false);
        return;
      }

      setOpen(false);
      resetState();
      onSwitched();
    } catch {
      setError("Connection error");
      setSwitching(false);
    }
  }, [botName, nodeQuery, authHeaders, logout, onSwitched, resetState]);

  const handleSelect = useCallback((profileName: string | null) => {
    if (profileName === currentAuth) {
      setOpen(false);
      return;
    }

    setPendingProfile(profileName);

    if (botState === "running") {
      setPhase("confirm");
    } else {
      patchConfig(profileName, false, false);
    }
  }, [currentAuth, botState, patchConfig]);

  const handleSwitchAndRestart = useCallback(() => {
    patchConfig(pendingProfile, true, false);
  }, [pendingProfile, patchConfig]);

  const handleForceRestart = useCallback(() => {
    patchConfig(pendingProfile, true, true);
  }, [pendingProfile, patchConfig]);

  const handleJustSave = useCallback(() => {
    patchConfig(pendingProfile, false, false);
  }, [pendingProfile, patchConfig]);

  const hasProfiles = profiles && profiles.length > 0;
  const pendingLabel = pendingProfile ? humanizeProfileName(pendingProfile) : "default";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground mb-1">AUTH</div>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex w-full items-center gap-1.5 rounded-md px-2 py-1 -mx-2 -my-1 min-h-11 sm:min-h-0 text-sm text-card-foreground",
              "hover:bg-accent/50 transition-colors cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              switching && "opacity-50 pointer-events-none",
            )}
            disabled={switching}
          >
            {switching ? (
              <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
            ) : (
              currentAuthType && authTypeIcon(currentAuthType)
            )}
            <span className="truncate font-semibold">
              {currentAuth ? humanizeProfileName(currentAuth) : <span className="text-muted-foreground font-normal">default</span>}
            </span>
            {currentAuthType && (
              <Badge variant="outline" className="ml-1 text-xs shrink-0">{currentAuthType}</Badge>
            )}
            <ChevronDownIcon className={cn("ml-auto size-3.5 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-72" align="start">
          {phase === "list" && (
            <ProfileList
              profiles={profiles}
              profilesLoading={profilesLoading}
              profilesError={profilesError}
              currentAuth={currentAuth}
              hasProfiles={hasProfiles}
              switching={switching}
              error={error}
              onSelect={handleSelect}
              onRetry={refetchProfiles}
            />
          )}

          {phase === "confirm" && (
            <ConfirmView
              label={pendingLabel}
              switching={switching}
              error={error}
              onSwitchRestart={handleSwitchAndRestart}
              onJustSave={handleJustSave}
            />
          )}

          {phase === "confirm-force" && (
            <ForceConfirmView
              switching={switching}
              error={error}
              onForce={handleForceRestart}
              onJustSave={handleJustSave}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ProfileList({
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

function ConfirmView({
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

function ForceConfirmView({
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
