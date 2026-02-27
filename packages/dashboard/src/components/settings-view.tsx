"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface NodeEntry {
  name: string;
  host: string;
  port: number;
}

export function SettingsView() {
  const [nodes, setNodes] = useState<NodeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function fetchSettings() {
      try {
        const res = await fetch("/api/mesh/nodes");
        if (res.ok) {
          const data = await res.json();
          if (active) setNodes(data);
        }
      } catch {
        // Non-critical — settings page still renders
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchSettings();
    return () => { active = false; };
  }, []);

  if (loading) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Node info */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-card-foreground mb-3">Node Configuration</h2>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <span>Registered peers: <span className="font-semibold text-card-foreground">{nodes.length}</span></span>
          {nodes.map((n) => (
            <span key={n.name} className="font-mono text-xs">
              {n.name} → {n.host}:{n.port}
            </span>
          ))}
          {nodes.length === 0 && (
            <span className="text-xs">No peers configured. Use <code className="font-mono">mecha node add</code> to add one.</span>
          )}
        </div>
      </div>

      {/* Runtime info */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-card-foreground mb-3">Runtime</h2>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <span>CASA port range: <span className="font-mono text-card-foreground">7700-7799</span></span>
          <span>Agent port: <span className="font-mono text-card-foreground">7660</span></span>
          <span>MCP port: <span className="font-mono text-card-foreground">7680</span></span>
          <span>Dashboard port: <span className="font-mono text-card-foreground">3457</span></span>
        </div>
      </div>
    </div>
  );
}
