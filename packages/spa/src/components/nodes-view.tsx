import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GlobeIcon, CpuIcon, HardDriveIcon, NetworkIcon, ClockIcon, BoxIcon,
  PlusIcon, Loader2Icon, Trash2Icon, ArrowUpCircleIcon, WifiIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";
import { formatUptime } from "@/lib/format";
import { NodeAddForm } from "@/components/node-add-form";

interface NodeHealth {
  name: string;
  status: "online" | "offline";
  isLocal?: boolean;
  source?: "manual" | "discovered";
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

function InfoRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value == null) return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-card-foreground", mono && "font-mono")}>{value}</span>
    </div>
  );
}

interface NodeCardProps {
  node: NodeHealth;
  isLocal: boolean;
  onClick: () => void;
  onPing: () => void;
  onRemove: () => void;
  onPromote: () => void;
  pinging: boolean;
}

function NodeCard({ node, isLocal, onClick, onPing, onRemove, onPromote, pinging }: NodeCardProps) {
  const isOnline = node.status === "online";
  const isDiscovered = node.source === "discovered";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
        className="flex items-center justify-between cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className={cn(
            "size-2 rounded-full",
            isOnline ? "bg-success" : "bg-destructive",
          )} />
          <GlobeIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-card-foreground">{node.name}</span>
          {isLocal && <span className="text-xs text-muted-foreground">(local)</span>}
          {isDiscovered && (
            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              discovered
            </span>
          )}
        </div>
        <Badge variant={isOnline ? "default" : "destructive"}>
          {node.status}
        </Badge>
      </div>

      {/* Bot count */}
      {isOnline && node.botCount != null && (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
          <BoxIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-card-foreground">{node.botCount}</span>
          <span className="text-sm text-muted-foreground">bot{node.botCount !== 1 ? "s" : ""} running</span>
        </div>
      )}

      {/* Offline error */}
      {!isOnline && node.error && (
        <div className="text-xs text-destructive">Node unreachable</div>
      )}

      {/* Online details */}
      {isOnline && (
        <div className="flex flex-col gap-3 text-xs">
          {(node.hostname || node.platform) && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <CpuIcon className="size-3" /> System
              </div>
              <div className="flex flex-col gap-0.5 pl-4.5">
                <InfoRow label="Hostname" value={node.hostname} mono />
                <InfoRow label="OS" value={node.platform && node.arch ? `${node.platform} ${node.arch}` : node.platform} />
                <InfoRow label="Port" value={node.port} mono />
              </div>
            </div>
          )}
          {node.uptimeSeconds != null && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <ClockIcon className="size-3" /> Uptime
              </div>
              <div className="flex flex-col gap-0.5 pl-4.5">
                <InfoRow label="Up" value={formatUptime(node.uptimeSeconds)} />
                {node.latencyMs != null && <InfoRow label="Latency" value={`${node.latencyMs}ms`} mono />}
              </div>
            </div>
          )}
          {(node.lanIp || node.tailscaleIp || node.publicIp) && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <NetworkIcon className="size-3" /> Network
              </div>
              <div className="flex flex-col gap-0.5 pl-4.5">
                <InfoRow label="LAN" value={node.lanIp} mono />
                <InfoRow label="Tailscale" value={node.tailscaleIp} mono />
                <InfoRow label="Public" value={node.publicIp} mono />
              </div>
            </div>
          )}
          {(node.cpuCount != null || node.totalMemMB != null) && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <HardDriveIcon className="size-3" /> Resources
              </div>
              <div className="flex flex-col gap-0.5 pl-4.5">
                <InfoRow label="CPUs" value={node.cpuCount} mono />
                {node.totalMemMB != null && (
                  <InfoRow label="Memory" value={`${node.freeMemMB ?? "?"} / ${node.totalMemMB} MB`} mono />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {!isLocal && (
        <div className="flex items-center gap-1 border-t border-border pt-3">
          <TooltipIconButton tooltip="Ping" variant="ghost" size="icon-sm" onClick={onPing} disabled={pinging}>
            {pinging ? <Loader2Icon className="size-4 animate-spin" /> : <WifiIcon className="size-4" />}
          </TooltipIconButton>
          {isDiscovered && (
            <TooltipIconButton tooltip="Promote to manual" variant="ghost" size="icon-sm" onClick={onPromote}>
              <ArrowUpCircleIcon className="size-4" />
            </TooltipIconButton>
          )}
          <TooltipIconButton tooltip="Remove" variant="ghost" size="icon-sm" onClick={onRemove} className="text-destructive hover:text-destructive">
            <Trash2Icon className="size-4" />
          </TooltipIconButton>
        </div>
      )}
    </div>
  );
}

export function NodesView() {
  const navigate = useNavigate();
  const { authHeaders } = useAuth();
  const { data: nodes, loading, error, refetch } = useFetch<NodeHealth[]>("/mesh/nodes", { interval: 30_000 });
  const [showAddForm, setShowAddForm] = useState(false);
  const [pingingNode, setPingingNode] = useState<string | null>(null);
  const [pingResult, setPingResult] = useState<Record<string, string>>({});

  async function handlePing(name: string) {
    setPingingNode(name);
    try {
      const res = await fetch(`/nodes/${encodeURIComponent(name)}/ping`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
      });
      const data = await res.json();
      if (data.reachable) {
        setPingResult((p) => ({ ...p, [name]: `${data.latencyMs}ms` }));
      } else {
        setPingResult((p) => ({ ...p, [name]: data.error ?? "unreachable" }));
      }
    } catch {
      setPingResult((p) => ({ ...p, [name]: "error" }));
    } finally {
      setPingingNode(null);
    }
  }

  async function handleRemove(name: string) {
    await fetch(`/nodes/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: authHeaders,
      credentials: "include",
    });
    refetch();
  }

  async function handlePromote(name: string) {
    await fetch(`/nodes/${encodeURIComponent(name)}/promote`, {
      method: "POST",
      headers: authHeaders,
      credentials: "include",
    });
    refetch();
  }

  if (loading && !nodes) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {safeNodes.length} node{safeNodes.length !== 1 ? "s" : ""}
        </span>
        <Button size="sm" onClick={() => setShowAddForm(true)}>
          <PlusIcon className="size-4" />
          Add Node
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
          Failed to refresh — showing last known state.
        </div>
      )}

      {/* Ping results toast area */}
      {Object.keys(pingResult).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(pingResult).map(([name, result]) => (
            <span key={name} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-mono">
              {name}: {result}
            </span>
          ))}
        </div>
      )}

      {safeNodes.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No nodes available. Add a remote node to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {safeNodes.map((node) => (
            <NodeCard
              key={`${node.name}-${node.tailscaleIp ?? node.lanIp ?? ""}`}
              node={node}
              isLocal={node.isLocal === true}
              onClick={() => navigate(`/?node=${encodeURIComponent(node.name)}`)}
              onPing={() => handlePing(node.name)}
              onRemove={() => handleRemove(node.name)}
              onPromote={() => handlePromote(node.name)}
              pinging={pingingNode === node.name}
            />
          ))}
        </div>
      )}

      <NodeAddForm
        open={showAddForm}
        onOpenChange={setShowAddForm}
        onAdded={() => refetch()}
      />
    </div>
  );
}
