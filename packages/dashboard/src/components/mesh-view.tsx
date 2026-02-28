"use client";

import { GlobeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/lib/use-fetch";

interface NodeEntry {
  name: string;
  host: string;
  port: number;
  apiKey: string;
  publicKey?: string;
  fingerprint?: string;
  addedAt: string;
  managed?: boolean;
  serverUrl?: string;
}

export function MeshView() {
  const { data: nodes, loading, error } = useFetch<NodeEntry[]>("/api/mesh/nodes");

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
          <div className="flex items-center gap-2">
            <GlobeIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-card-foreground">{node.name}</span>
            {node.managed && <Badge variant="default">managed</Badge>}
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>
              Host: <span className="font-mono">{node.host}:{node.port}</span>
            </span>
            {node.fingerprint && (
              <span className="truncate font-mono" title={node.fingerprint}>
                {node.fingerprint}
              </span>
            )}
            {node.serverUrl && (
              <span className="truncate font-mono" title={node.serverUrl}>
                {node.serverUrl}
              </span>
            )}
            <span>Added: {new Date(node.addedAt).toLocaleDateString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
