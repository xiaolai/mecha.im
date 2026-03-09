import { useState, useRef, useEffect, useCallback } from "react";
import {
  KeyRoundIcon,
  StarIcon,
  TrashIcon,
  PlusIcon,
  PencilIcon,
  Loader2Icon,
  CheckCircle2Icon,
  XCircleIcon,
  ActivityIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";
import { AddProfileDialog, RenewTokenDialog } from "@/components/auth-profile-dialogs";

interface AuthProfile {
  name: string;
  type: "oauth" | "api-key";
  account: string | null;
  label: string;
  isDefault: boolean;
  tags: string[];
  expiresAt: number | null;
  createdAt: string;
}

function SectionHeader({ icon: Icon, title, action }: { icon: React.ComponentType<{ className?: string }>; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="size-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      {children}
    </div>
  );
}

/** Renders the auth profiles management card with add, test, set-default, renew, and remove actions. */
export function AuthProfilesSection() {
  const { authHeaders } = useAuth();
  const { data: profiles, error: profilesError, refetch } = useFetch<AuthProfile[]>("/settings/auth-profiles");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [renewTarget, setRenewTarget] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, "testing" | "valid" | "invalid">>({});
  const confirmRef = useRef<HTMLButtonElement>(null);
  const testTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (confirmDelete && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [confirmDelete]);

  // Clear all test status timers on unmount
  useEffect(() => {
    const timers = testTimersRef.current;
    return () => { for (const t of timers.values()) clearTimeout(t); };
  }, []);

  async function setDefault(name: string) {
    setBusy(name);
    setMutError(null);
    try {
      const res = await fetch("/settings/auth-profiles/default", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setMutError(body.error ?? "Failed to set default");
        return;
      }
      await refetch();
    } catch {
      setMutError("Connection error");
    } finally {
      setBusy(null);
    }
  }

  async function removeProfile(name: string) {
    setBusy(name);
    setMutError(null);
    try {
      const res = await fetch(`/settings/auth-profiles/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setMutError(body.error ?? "Failed to remove profile");
        return;
      }
      setConfirmDelete(null);
      await refetch();
    } catch {
      setMutError("Connection error");
    } finally {
      setBusy(null);
    }
  }

  const testProfile = useCallback(async (name: string) => {
    setTestStatus((prev) => ({ ...prev, [name]: "testing" }));
    try {
      const res = await fetch(`/settings/auth-profiles/${encodeURIComponent(name)}/test`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) {
        setTestStatus((prev) => ({ ...prev, [name]: "invalid" }));
      } else {
        const data = await res.json();
        setTestStatus((prev) => ({ ...prev, [name]: data.valid ? "valid" : "invalid" }));
      }
    } catch {
      setTestStatus((prev) => ({ ...prev, [name]: "invalid" }));
    }
    // Clear previous timer for this profile if re-tested quickly
    const prev = testTimersRef.current.get(name);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      testTimersRef.current.delete(name);
      setTestStatus((s) => {
        const next = { ...s };
        delete next[name];
        return next;
      });
    }, 3000);
    testTimersRef.current.set(name, timer);
  }, [authHeaders]);

  if (profilesError) {
    return (
      <Card className="sm:col-span-2">
        <SectionHeader icon={KeyRoundIcon} title="Auth Profiles" />
        <p className="text-sm text-destructive">Failed to load auth profiles.</p>
      </Card>
    );
  }

  if (!profiles) return null;

  const stored = profiles.filter((p) => !p.name.startsWith("$env:"));
  const env = profiles.filter((p) => p.name.startsWith("$env:"));

  return (
    <>
      <Card className="sm:col-span-2">
        <SectionHeader
          icon={KeyRoundIcon}
          title="Auth Profiles"
          action={
            <TooltipIconButton
              tooltip="Add profile"
              variant="ghost"
              size="icon-xs"
              onClick={() => setAddOpen(true)}
            >
              <PlusIcon className="size-3" />
            </TooltipIconButton>
          }
        />

        {profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No auth profiles configured. Click <span className="font-medium text-card-foreground">+</span> to create one.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {stored.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-card-foreground truncate">{p.name}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{p.type}</Badge>
                    {p.isDefault && (
                      <Badge variant="default" className="text-[10px] shrink-0">default</Badge>
                    )}
                    {testStatus[p.name] === "testing" && (
                      <Loader2Icon className="size-3 animate-spin text-muted-foreground shrink-0" />
                    )}
                    {testStatus[p.name] === "valid" && (
                      <CheckCircle2Icon className="size-3 text-success shrink-0" />
                    )}
                    {testStatus[p.name] === "invalid" && (
                      <XCircleIcon className="size-3 text-destructive shrink-0" />
                    )}
                  </div>
                  {p.label && (
                    <span className="text-xs text-muted-foreground truncate">{p.label}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {confirmDelete === p.name ? (
                    <>
                      <Button
                        ref={confirmDelete === p.name ? confirmRef : undefined}
                        variant="destructive"
                        size="xs"
                        disabled={busy === p.name}
                        onClick={() => removeProfile(p.name)}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy === p.name}
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <TooltipIconButton
                        tooltip="Test token"
                        variant="ghost"
                        size="icon-xs"
                        disabled={busy === p.name || testStatus[p.name] === "testing"}
                        onClick={() => testProfile(p.name)}
                      >
                        <ActivityIcon className="size-3" />
                      </TooltipIconButton>
                      {!p.isDefault && (
                        <TooltipIconButton
                          tooltip="Set as default"
                          variant="ghost"
                          size="icon-xs"
                          disabled={busy === p.name}
                          onClick={() => setDefault(p.name)}
                        >
                          <StarIcon className="size-3" />
                        </TooltipIconButton>
                      )}
                      <TooltipIconButton
                        tooltip="Renew token"
                        variant="ghost"
                        size="icon-xs"
                        disabled={busy === p.name}
                        onClick={() => setRenewTarget(p.name)}
                      >
                        <PencilIcon className="size-3" />
                      </TooltipIconButton>
                      <TooltipIconButton
                        tooltip="Remove"
                        variant="ghost"
                        size="icon-xs"
                        className="text-destructive hover:text-destructive"
                        disabled={busy === p.name}
                        onClick={() => setConfirmDelete(p.name)}
                      >
                        <TrashIcon className="size-3" />
                      </TooltipIconButton>
                    </>
                  )}
                </div>
              </div>
            ))}

            {env.length > 0 && (
              <>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
                  Environment
                </div>
                {env.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 text-sm"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-card-foreground truncate">{p.label || p.name}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">{p.type}</Badge>
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">read-only</span>
                  </div>
                ))}
              </>
            )}

            {mutError && (
              <p className="text-xs text-destructive mt-1">{mutError}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Default profile is used when spawning bots without explicit <code className="font-mono text-card-foreground">--auth</code>.
            </p>
          </div>
        )}
      </Card>

      <AddProfileDialog open={addOpen} onOpenChange={setAddOpen} onCreated={refetch} />
      <RenewTokenDialog
        open={renewTarget !== null}
        onOpenChange={(open) => { if (!open) setRenewTarget(null); }}
        profileName={renewTarget ?? ""}
        onRenewed={refetch}
      />
    </>
  );
}
