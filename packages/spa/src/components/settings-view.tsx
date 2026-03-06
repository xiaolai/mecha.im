import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ServerIcon,
  NetworkIcon,
  ShieldCheckIcon,
  CpuIcon,
  RadioIcon,
  Loader2Icon,
  GaugeIcon,
  KeyRoundIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";
import { NodeNameEditor } from "@/components/node-name-editor";
import { formatUptime, formatUptimeFromIso } from "@/lib/format";

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

interface NetworkSettings {
  forceHttps: boolean;
}

interface TotpStatus {
  configured: boolean;
  source: "file" | "env" | null;
}

interface MeterStatus {
  running: boolean;
  port?: number;
  pid?: number;
  required?: boolean;
  startedAt?: string;
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

export function SettingsView() {
  const { authHeaders } = useAuth();
  const { data: info, loading: infoLoading } = useFetch<NodeInfo>("/node/info", { interval: 30_000 });
  const { data: runtime, loading: runtimeLoading, error: runtimeError } = useFetch<RuntimeConfig>("/settings/runtime");
  const { data: totp, loading: totpLoading, error: totpError } = useFetch<TotpStatus>("/settings/totp");
  const { data: network, loading: networkLoading, refetch: refetchNetwork } = useFetch<NetworkSettings>("/settings/network");
  const { data: meter, loading: meterLoading } = useFetch<MeterStatus>("/meter/status", { interval: 30_000 });
  const [httpsToggling, setHttpsToggling] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  async function toggleForceHttps() {
    if (!network) return;
    setHttpsToggling(true);
    setNetworkError(null);
    try {
      const res = await fetch("/settings/network", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ forceHttps: !network.forceHttps }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setNetworkError(data.error ?? "Failed to update network settings");
        return;
      }
      refetchNetwork();
    } finally {
      setHttpsToggling(false);
    }
  }

  if (infoLoading || runtimeLoading || totpLoading || networkLoading || meterLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
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
            <NodeNameEditor currentName={info.node} />
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

      {/* Meter Status */}
      <Card>
        <SectionHeader icon={GaugeIcon} title="Meter Daemon" />
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">Status</span>
            <Badge variant={meter?.running ? "default" : "secondary"}>
              {meter?.running ? "Running" : "Stopped"}
            </Badge>
          </div>
          {meter?.running && (
            <>
              <InfoRow label="Port" value={meter.port} mono />
              <InfoRow label="PID" value={meter.pid} mono />
              {meter.startedAt && (
                <InfoRow label="Uptime" value={formatUptimeFromIso(meter.startedAt)} />
              )}
              {meter.required != null && (
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-muted-foreground">Required</span>
                  <span className="text-card-foreground">{meter.required ? "Yes" : "No"}</span>
                </div>
              )}
            </>
          )}
          {!meter?.running && (
            <p className="text-xs text-muted-foreground mt-1">
              Run <code className="font-mono text-card-foreground">mecha meter start</code> to enable cost tracking.
            </p>
          )}
        </div>
      </Card>

      {/* Network */}
      <Card>
        <SectionHeader icon={NetworkIcon} title="Network" />
        {runtimeError ? (
          <p className="text-sm text-destructive">Unable to load network config.</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-col gap-1">
              {runtime && <InfoRow label="Agent Port" value={runtime.agentPort} mono />}
              {info?.lanIp && <InfoRow label="LAN" value={info.lanIp} mono />}
              {info?.tailscaleIp && <InfoRow label="Tailscale" value={info.tailscaleIp} mono />}
              {info?.publicIp && <InfoRow label="Public IP" value={info.publicIp} mono />}
            </div>
            {network && (
              <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-card-foreground">Force HTTPS</span>
                  <span className="text-xs text-muted-foreground">
                    Redirect HTTP &rarr; HTTPS. Enable when exposed on a public domain.
                  </span>
                </div>
                <Button
                  variant={network.forceHttps ? "default" : "outline"}
                  size="sm"
                  className="min-h-11 sm:min-h-0 shrink-0"
                  disabled={httpsToggling}
                  onClick={toggleForceHttps}
                  aria-pressed={network.forceHttps}
                >
                  {httpsToggling && <Loader2Icon className="size-4 animate-spin" />}
                  {network.forceHttps ? "On" : "Off"}
                </Button>
              </div>
            )}
            {networkError && (
              <p className="text-xs text-destructive">{networkError}</p>
            )}
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

      {/* Auth Profiles Link */}
      <Card className="sm:col-span-2">
        <SectionHeader icon={KeyRoundIcon} title="Auth Profiles" />
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Manage API keys and OAuth tokens for bot authentication.
          </p>
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-0 shrink-0 gap-1.5" asChild>
            <Link to="/auth">
              Manage
              <ExternalLinkIcon className="size-3" />
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
