import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/lib/use-fetch";

interface NodeEntry {
  name: string;
  host: string;
  port: number;
}

interface RuntimeConfig {
  casaPortRange: string;
  agentPort: number;
  mcpPort: number;
}

export function SettingsView() {
  const { data: nodes, loading: nodesLoading, error: nodesError } = useFetch<NodeEntry[]>("/mesh/nodes");
  const { data: runtime, loading: runtimeLoading } = useFetch<RuntimeConfig>("/settings/runtime");

  if (nodesLoading || runtimeLoading) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  if (nodesError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {nodesError}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Node info */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-card-foreground mb-3">Node Configuration</h2>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <span>Registered peers: <span className="font-semibold text-card-foreground">{nodes?.length ?? 0}</span></span>
          {nodes?.map((n) => (
            <span key={n.name} className="font-mono text-xs">
              {n.name} → {n.host}:{n.port}
            </span>
          ))}
          {(!nodes || nodes.length === 0) && (
            <span className="text-xs">No peers configured. Use <code className="font-mono">mecha node add</code> to add one.</span>
          )}
        </div>
      </div>

      {/* Runtime info */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-card-foreground mb-3">Runtime</h2>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <span>CASA port range: <span className="font-mono text-card-foreground">{runtime?.casaPortRange ?? "7700-7799"}</span></span>
          <span>Agent port: <span className="font-mono text-card-foreground">{runtime?.agentPort ?? 7660}</span></span>
          <span>MCP port: <span className="font-mono text-card-foreground">{runtime?.mcpPort ?? 7680}</span></span>
        </div>
      </div>
    </div>
  );
}
