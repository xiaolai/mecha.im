import { useState, useCallback } from "react";
import { useAuth } from "@/auth-context";

export type CasaActionType = "stop" | "kill" | "start" | "restart";

export interface BusyWarning {
  activeSessions: number;
  lastActivity?: string;
  pendingAction: CasaActionType;
}

interface UseCasaActionResult {
  acting: boolean;
  actionError: string | null;
  busyWarning: BusyWarning | null;
  handleAction: (action: CasaActionType, opts?: { force?: boolean }) => Promise<void>;
  confirmForce: () => Promise<void>;
  dismissBusy: () => void;
}

/**
 * Shared hook for CASA lifecycle actions with loading, error, and busy-warning state.
 * @param name - CASA name
 * @param onDone - optional callback after action completes (e.g. refetch)
 * @param node - optional node name for remote dispatch
 */
export function useCasaAction(name: string, onDone?: () => void, node?: string): UseCasaActionResult {
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyWarning, setBusyWarning] = useState<BusyWarning | null>(null);
  const { authHeaders, logout } = useAuth();

  const handleAction = useCallback(async (action: CasaActionType, opts?: { force?: boolean }) => {
    setActing(true);
    setActionError(null);
    setBusyWarning(null);
    let succeeded = false;
    try {
      const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
      const needsBody = opts?.force && (action === "stop" || action === "restart");
      const res = await fetch(`/casas/${encodeURIComponent(name)}/${action}${nodeQuery}`, {
        method: "POST",
        headers: {
          ...authHeaders,
          ...(needsBody ? { "content-type": "application/json" } : {}),
        },
        credentials: "include",
        body: needsBody ? JSON.stringify({ force: true }) : undefined,
      });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        if (body.code === "CASA_BUSY") {
          setBusyWarning({
            activeSessions: body.activeSessions ?? 0,
            lastActivity: body.lastActivity,
            pendingAction: action,
          });
        } else {
          setActionError(body.error ?? `Failed to ${action}`);
        }
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

  const confirmForce = useCallback(async () => {
    if (!busyWarning) return;
    const action = busyWarning.pendingAction;
    setBusyWarning(null);
    await handleAction(action, { force: true });
  }, [busyWarning, handleAction]);

  const dismissBusy = useCallback(() => {
    setBusyWarning(null);
  }, []);

  return { acting, actionError, busyWarning, handleAction, confirmForce, dismissBusy };
}
