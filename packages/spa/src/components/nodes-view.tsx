import { useNavigate } from "react-router-dom";
import { GlobeIcon, CpuIcon, HardDriveIcon, NetworkIcon, ClockIcon, BoxIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";

interface NodeHealth {
  name: string;
  status: "online" | "offline";
  isLocal?: boolean;
  latencyMs?: number;
  error?: string;
  botCount?: number;
  hostname?: string;
  platform?: string;
  arch?: string;
  port?: number;
  uptimeSeconds?: number;
  startedAt?: string;
  totalMemMB?: number;
  freeMemMB?: number;
  cpuCount?: number;
  lanIp?: string;
  tailscaleIp?: string;
  publicIp?: string;
}

function formatUptime(s: number): string {
  const clamped = Math.max(0, Math.floor(s));
  const d = Math.floor(clamped / 86400);
  const h = Math.floor((clamped % 86400) / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const sec = clamped % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function InfoRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value == null) return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-card-foreground", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function NodeCard({ node, isLocal, onClick }: { node: NodeHealth; isLocal: boolean; onClick: () => void }) {
  const isOnline = node.status === "online";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 cursor-pointer transition-colors hover:bg-accent/30"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn(
            "size-2 rounded-full",
            isOnline ? "bg-success" : "bg-destructive",
          )} />
          <GlobeIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-card-foreground">{node.name}</span>
          {isLocal && <span className="text-xs text-muted-foreground">(local)</span>}
        </div>
        <Badge variant={isOnline ? "default" : "destructive"}>
          {node.status}
        </Badge>
      </div>

      {/* Bot count — prominent display */}
      {isOnline && node.botCount != null && (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
          <BoxIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-card-foreground">{node.botCount}</span>
          <span className="text-sm text-muted-foreground">bot{node.botCount !== 1 ? "s" : ""} running</span>
        </div>
      )}

      {/* Offline: show error only */}
      {!isOnline && node.error && (
        <div className="text-xs text-destructive">Node unreachable</div>
      )}

      {/* Online: show rich details */}
      {isOnline && (
        <div className="flex flex-col gap-3 text-xs">
          {/* System */}
          {(node.hostname || node.platform) && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <CpuIcon className="size-3" />
                System
              </div>
              <div className="flex flex-col gap-0.5 pl-4.5">
                <InfoRow label="Hostname" value={node.hostname} mono />
                <InfoRow label="OS" value={node.platform && node.arch ? `${node.platform} ${node.arch}` : node.platform} />
                <InfoRow label="Port" value={node.port} mono />
              </div>
            </div>
          )}

          {/* Uptime */}
          {node.uptimeSeconds != null && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <ClockIcon className="size-3" />
                Uptime
              </div>
              <div className="flex flex-col gap-0.5 pl-4.5">
                <InfoRow label="Up" value={formatUptime(node.uptimeSeconds)} />
                {node.latencyMs != null && (
                  <InfoRow label="Latency" value={`${node.latencyMs}ms`} mono />
                )}
              </div>
            </div>
          )}

          {/* Network */}
          {(node.lanIp || node.tailscaleIp || node.publicIp) && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <NetworkIcon className="size-3" />
                Network
              </div>
              <div className="flex flex-col gap-0.5 pl-4.5">
                <InfoRow label="LAN" value={node.lanIp} mono />
                <InfoRow label="Tailscale" value={node.tailscaleIp} mono />
                <InfoRow label="Public" value={node.publicIp} mono />
              </div>
            </div>
          )}

          {/* Resources */}
          {(node.cpuCount != null || node.totalMemMB != null) && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <HardDriveIcon className="size-3" />
                Resources
              </div>
              <div className="flex flex-col gap-0.5 pl-4.5">
                <InfoRow label="CPUs" value={node.cpuCount} mono />
                {node.totalMemMB != null && (
                  <InfoRow
                    label="Memory"
                    value={`${node.freeMemMB ?? "?"} / ${node.totalMemMB} MB`}
                    mono
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NodesView() {
  const navigate = useNavigate();
  const { data: nodes, loading, error } = useFetch<NodeHealth[]>("/mesh/nodes", { interval: 30_000 });

  if (loading && !nodes) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-48 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error && !nodes) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load nodes.
      </div>
    );
  }

  const safeNodes = Array.isArray(nodes) ? nodes : [];

  if (safeNodes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No nodes available.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div role="alert" className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
          Failed to refresh — showing last known state.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {safeNodes.map((node) => (
          <NodeCard
            key={`${node.name}-${node.tailscaleIp ?? node.lanIp ?? ""}`}
            node={node}
            isLocal={node.isLocal === true}
            onClick={() => navigate(`/?node=${encodeURIComponent(node.name)}`)}
          />
        ))}
      </div>
    </div>
  );
}
