"use client";

import { useCallback, useEffect, useRef } from "react";
import { useDashboardStore } from "@/lib/store";
import type { MechaWithNode } from "@/lib/store";

export function EventStreamProvider({ children }: { children: React.ReactNode }) {
  const setMechas = useDashboardStore((s) => s.setMechas);
  const selectedMechaId = useDashboardStore((s) => s.selectedMechaId);
  const setSelectedMechaId = useDashboardStore((s) => s.setSelectedMechaId);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMechas = useCallback(async () => {
    try {
      const res = await fetch("/api/mechas");
      if (res.ok) {
        const data = await res.json();
        // API returns array with ports shape; normalize to MechaWithNode
        const mechas: MechaWithNode[] = data.map((m: Record<string, unknown>) => ({
          id: m.id as string,
          name: (m.name as string) || (m.id as string),
          state: m.state as string,
          status: (m.status as string) || "",
          path: (m.path as string) || "",
          port: (m.ports as Array<{ PublicPort?: number }>)?.find((p) => p.PublicPort)?.PublicPort,
          ports: (m.ports as Array<Record<string, unknown>>) || [],
          created: (m.created as number) || 0,
          node: (m.node as string) || "local",
        }));
        setMechas(mechas);

        // If selected mecha was removed, clear selection
        if (selectedMechaId && !mechas.some((m: MechaWithNode) => m.id === selectedMechaId)) {
          setSelectedMechaId(null);
        }
      }
    } catch { /* ignore fetch errors */ }
  }, [setMechas, selectedMechaId, setSelectedMechaId]);

  useEffect(() => {
    fetchMechas();
    intervalRef.current = setInterval(fetchMechas, 5000);

    function onVisibilityChange() {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        fetchMechas();
        intervalRef.current = setInterval(fetchMechas, 5000);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchMechas]);

  return <>{children}</>;
}
