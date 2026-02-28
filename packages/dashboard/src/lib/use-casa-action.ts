"use client";

import { useState, useCallback } from "react";

interface UseCasaActionResult {
  acting: boolean;
  actionError: string | null;
  handleAction: (action: "stop" | "kill") => Promise<void>;
}

/**
 * Shared hook for stop/kill CASA actions with loading + error state.
 * @param name - CASA name
 * @param onDone - optional callback after action completes (e.g. refetch)
 */
export function useCasaAction(name: string, onDone?: () => void): UseCasaActionResult {
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = useCallback(async (action: "stop" | "kill") => {
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/casas/${encodeURIComponent(name)}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setActionError(body.error ?? `Failed to ${action}`);
      }
    } catch {
      setActionError(`Failed to ${action} — connection error`);
    } finally {
      setActing(false);
      onDone?.();
    }
  }, [name, onDone]);

  return { acting, actionError, handleAction };
}
