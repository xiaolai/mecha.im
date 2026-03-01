import { GlobeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";

interface NodeHealth {
  name: string;
  status: "online" | "offline";
  latencyMs?: number;
  error?: string;
  casaCount?: number;
}

export function MeshView() {
  const { data: nodes, loading, error } = useFetch<NodeHealth[]>("/mesh/nodes", { interval: 30_000 });

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!nodes || nodes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No mesh nodes configured.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Use <code className="font-mono">mecha node add</code> to add a peer.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {nodes.map((node) => (
        <div key={node.name} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                "size-2 rounded-full",
                node.status === "online" ? "bg-success" : "bg-destructive",
              )} />
              <GlobeIcon className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-card-foreground">{node.name}</span>
            </div>
            <Badge variant={node.status === "online" ? "default" : "destructive"}>
              {node.status}
            </Badge>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {node.latencyMs != null && (
              <span>Latency: <span className="font-mono">{node.latencyMs}ms</span></span>
            )}
            {node.casaCount != null && (
              <span>CASAs: <span className="font-mono">{node.casaCount}</span></span>
            )}
            {node.error && (
              <span className="text-destructive">{node.error}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
