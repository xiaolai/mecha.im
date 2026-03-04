import { useState, useCallback } from "react";
import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";
import { humanizeProfileName, authTypeIcon } from "@/lib/auth-utils";
import { ProfileList, ConfirmView, ForceConfirmView } from "./auth-switcher-panels";
import type { AuthProfile } from "./auth-switcher-panels";

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
