"use client";

import { useEffect, useState } from "react";
import { CasaCard, type CasaInfo } from "./casa-card";
import { Skeleton } from "@/components/ui/skeleton";

export function CasaList() {
  const [casas, setCasas] = useState<CasaInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchCasas() {
      try {
        const res = await fetch("/api/casas");
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Failed to fetch" }));
          if (active) setError(body.error ?? "Failed to fetch CASAs");
          return;
        }
        const data = await res.json();
        if (active) {
          setCasas(data);
          setError(null);
        }
      } catch {
        if (active) setError("Failed to connect to server");
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchCasas();
    const interval = setInterval(fetchCasas, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
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

  if (casas.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No CASAs running.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Use <code className="font-mono">mecha spawn</code> to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {casas.map((casa) => (
        <CasaCard key={casa.name} casa={casa} />
      ))}
    </div>
  );
}
