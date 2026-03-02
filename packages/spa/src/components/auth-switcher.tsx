import { useState, useCallback } from "react";
import { ChevronDownIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

interface AuthProfile {
  name: string;
  type: "oauth" | "api-key";
  label?: string;
  isDefault: boolean;
  tags?: string[];
}

interface AuthSwitcherProps {
  casaName: string;
  currentAuth: string | undefined;
  currentAuthType: string | undefined;
  casaState: string;
  node?: string;
  onSwitched: () => void;
  onRestartNeeded: () => void;
}

export function AuthSwitcher({ casaName, currentAuth, currentAuthType, casaState, node, onSwitched, onRestartNeeded }: AuthSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { authHeaders, logout } = useAuth();

  const { data: profiles, error: profilesError } = useFetch<AuthProfile[]>("/auth/profiles");

  const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";

  const handleSwitch = useCallback(async (profileName: string | null) => {
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch(`/casas/${encodeURIComponent(casaName)}/config${nodeQuery}`, {
        method: "PATCH",
        headers: { ...authHeaders, "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ auth: profileName }),
      });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to switch auth" }));
        setError(body.error ?? "Failed to switch auth");
        return;
      }
      setOpen(false);
      onSwitched();
      if (casaState === "running") onRestartNeeded();
    } catch {
      setError("Connection error");
    } finally {
      setSwitching(false);
    }
  }, [casaName, nodeQuery, casaState, authHeaders, logout, onSwitched, onRestartNeeded]);

  const hasProfiles = profiles && profiles.length > 0;
  const showDropdown = open && (hasProfiles || currentAuth || profilesError);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground mb-1">AUTH</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 text-sm text-card-foreground",
            "hover:text-foreground transition-colors cursor-pointer",
            switching && "opacity-50 pointer-events-none",
          )}
          disabled={switching}
        >
          {switching && <Loader2Icon className="size-3.5 animate-spin" />}
          <span>{currentAuth ?? "—"}</span>
          {currentAuthType && (
            <Badge variant="outline" className="ml-1 text-xs">{currentAuthType}</Badge>
          )}
          <ChevronDownIcon className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {error && (
        <div className="mt-2 text-xs text-destructive">{error}</div>
      )}

      {showDropdown && (
        <div className="mt-2 rounded-md border border-border bg-popover text-popover-foreground p-1 shadow-md">
          {profilesError && (
            <div className="px-2 py-1.5 text-xs text-destructive">Failed to load profiles</div>
          )}
          {hasProfiles && profiles.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => handleSwitch(p.name)}
              disabled={switching}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default",
                "hover:bg-accent hover:text-accent-foreground",
                switching && "opacity-50 pointer-events-none",
              )}
            >
              <span className="size-4 flex items-center justify-center">
                {p.name === currentAuth && <CheckIcon className="size-3.5 text-primary" />}
              </span>
              <span>{p.name.startsWith("$env:") ? p.label || p.name : p.name}</span>
              <Badge variant="outline" className="ml-auto text-xs">{p.type}</Badge>
              {p.isDefault && (
                <span className="text-xs text-muted-foreground">default</span>
              )}
            </button>
          ))}
          {currentAuth && (
            <button
              type="button"
              onClick={() => handleSwitch(null)}
              disabled={switching}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default",
                "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                switching && "opacity-50 pointer-events-none",
              )}
            >
              <span className="size-4" />
              <span>Clear auth</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
