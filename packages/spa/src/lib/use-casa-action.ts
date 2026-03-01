import { useState, useCallback } from "react";
import { useAuth } from "@/auth-context";

type CasaActionType = "stop" | "kill";

interface UseCasaActionResult {
  acting: boolean;
  actionError: string | null;
  handleAction: (action: "stop" | "kill") => Promise<void>;
}

/**
 * Shared hook for stop/kill CASA actions with loading + error state.
 * @param name - CASA name
 * @param onDone - optional callback after action completes (e.g. refetch)
 * @param node - optional node name for remote dispatch
 */
export function useCasaAction(name: string, onDone?: () => void, node?: string): UseCasaActionResult {
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { authHeaders, logout } = useAuth();

  const handleAction = useCallback(async (action: CasaActionType) => {
    setActing(true);
    setActionError(null);
    let succeeded = false;
    try {
      const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
      const res = await fetch(`/casas/${encodeURIComponent(name)}/${action}${nodeQuery}`, {
        method: "POST",
        headers: authHeaders,
      });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setActionError(body.error ?? `Failed to ${action}`);
      } else {
        succeeded = true;
      }
    } catch {
      setActionError(`Failed to ${action} — connection error`);
    } finally {
      setActing(false);
      if (succeeded) onDone?.();
    }
  }, [name, node, onDone, authHeaders, logout]);

  return { acting, actionError, handleAction };
}
