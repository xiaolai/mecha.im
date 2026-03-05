import { useState, useRef, useEffect } from "react";
import {
  ServerIcon,
  NetworkIcon,
  ShieldCheckIcon,
  CpuIcon,
  RadioIcon,
  KeyRoundIcon,
  StarIcon,
  TrashIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

interface NodeInfo {
  node: string;
  hostname: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  startedAt: string;
  botCount: number;
  totalMemMB: number;
  freeMemMB: number;
  cpuCount: number;
  lanIp?: string;
  tailscaleIp?: string;
  publicIp?: string;
}

interface RuntimeConfig {
  botPortRange: string;
  agentPort: number;
  mcpPort: number;
  discovery: {
    enabled: boolean;
    discoveredCount: number;
    manualCount: number;
  };
}

interface TotpStatus {
  configured: boolean;
  source: "file" | "env" | null;
}

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

function formatUptime(s: number): string {
  const clamped = Math.max(0, Math.floor(s));
  const d = Math.floor(clamped / 86400);
  const h = Math.floor((clamped % 86400) / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatMemory(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function InfoRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value == null) return null;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-card-foreground text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="size-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
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

function AuthProfilesSection() {
  const { authHeaders } = useAuth();
  const { data: profiles, error: profilesError, refetch } = useFetch<AuthProfile[]>("/settings/auth-profiles");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmDelete && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [confirmDelete]);

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
    } finally {
      setBusy(null);
    }
  }

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
    <Card className="sm:col-span-2">
      <SectionHeader icon={KeyRoundIcon} title="Auth Profiles" />

      {profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No auth profiles configured. Use <code className="font-mono text-card-foreground">mecha auth add</code> to create one.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Stored profiles */}
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

          {/* Env profiles */}
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
            Manage via <code className="font-mono text-card-foreground">mecha auth add/rm/switch</code>. Default profile is used when spawning bots without explicit <code className="font-mono text-card-foreground">--auth</code>.
          </p>
        </div>
      )}
    </Card>
  );
}

export function SettingsView() {
  const { data: info, loading: infoLoading, error: infoError } = useFetch<NodeInfo>("/node/info", { interval: 30_000 });
  const { data: runtime, loading: runtimeLoading, error: runtimeError } = useFetch<RuntimeConfig>("/settings/runtime");
  const { data: totp, loading: totpLoading, error: totpError } = useFetch<TotpStatus>("/settings/totp");

  if (infoLoading || runtimeLoading || totpLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* This Node */}
      <Card className="sm:col-span-2">
        <SectionHeader icon={ServerIcon} title="This Node" />
        {info ? (
          <div className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <InfoRow label="Node Name" value={info.node} mono />
            <InfoRow label="Hostname" value={info.hostname} mono />
            <InfoRow label="OS" value={`${info.platform} ${info.arch}`} />
            <InfoRow label="CPUs" value={info.cpuCount} mono />
            <InfoRow label="Memory" value={`${formatMemory(info.freeMemMB)} free / ${formatMemory(info.totalMemMB)}`} mono />
            <InfoRow label="Active Bots" value={info.botCount} mono />
            <InfoRow label="Uptime" value={formatUptime(info.uptimeSeconds)} />
            <InfoRow label="Started" value={new Date(info.startedAt).toLocaleString()} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Unable to load node info.</p>
        )}
      </Card>

      {/* Network */}
      <Card>
        <SectionHeader icon={NetworkIcon} title="Network" />
        {runtimeError ? (
          <p className="text-sm text-destructive">Unable to load network config.</p>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            {runtime && <InfoRow label="Agent Port" value={runtime.agentPort} mono />}
            {info?.lanIp && <InfoRow label="LAN" value={info.lanIp} mono />}
            {info?.tailscaleIp && <InfoRow label="Tailscale" value={info.tailscaleIp} mono />}
            {info?.publicIp && <InfoRow label="Public IP" value={info.publicIp} mono />}
          </div>
        )}
      </Card>

      {/* TOTP */}
      <Card>
        <SectionHeader icon={ShieldCheckIcon} title="Dashboard Auth (TOTP)" />
        {totpError ? (
          <p className="text-sm text-destructive">Unable to load TOTP status.</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={totp?.configured ? "default" : "destructive"}>
                {totp?.configured ? "Active" : "Not configured"}
              </Badge>
            </div>
            {totp?.configured && (
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">Source</span>
                <span className="text-xs font-mono text-card-foreground">
                  {totp.source === "env" ? "MECHA_OTP env var" : "~/.mecha/totp-secret"}
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {totp?.configured
                ? "TOTP protects the dashboard. Use any authenticator app to generate codes."
                : <>Run <code className="font-mono text-card-foreground">mecha dashboard totp</code> to generate a secret and enable TOTP login.</>
              }
            </p>
          </div>
        )}
      </Card>

      {/* Runtime */}
      <Card>
        <SectionHeader icon={CpuIcon} title="Runtime" />
        {runtimeError ? (
          <p className="text-sm text-destructive">Unable to load runtime config.</p>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            {runtime && (
              <>
                <InfoRow label="Bot Port Range" value={runtime.botPortRange} mono />
                <InfoRow label="MCP Port" value={runtime.mcpPort} mono />
              </>
            )}
          </div>
        )}
      </Card>

      {/* Auto-Discovery */}
      <Card>
        <SectionHeader icon={RadioIcon} title="Auto-Discovery" />
        {runtime?.discovery ? (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={runtime.discovery.enabled ? "default" : "secondary"}>
                {runtime.discovery.enabled ? "Active" : "Disabled"}
              </Badge>
            </div>
            {runtime.discovery.enabled ? (
              <>
                <InfoRow label="Discovered Nodes" value={runtime.discovery.discoveredCount} mono />
                <InfoRow label="Manual Nodes" value={runtime.discovery.manualCount} mono />
                <p className="text-xs text-muted-foreground mt-1">
                  Scanning Tailscale peers every 60s. Nodes sharing the same cluster key are automatically registered.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                Set <code className="font-mono text-card-foreground">MECHA_CLUSTER_KEY</code> in your environment to enable auto-discovery across Tailscale peers.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Unable to load discovery status.</p>
        )}
      </Card>

      {/* Auth Profiles */}
      <AuthProfilesSection />
    </div>
  );
}
