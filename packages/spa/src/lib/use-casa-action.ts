import { useState, useCallback } from "react";
import { useAuth } from "@/auth-context";

export type CasaActionType = "stop" | "kill" | "start" | "restart";

export interface BusyWarning {
  activeSessions: number;
  lastActivity?: string;
  pendingAction: CasaActionType;
}

/** Actions that require user confirmation before executing. */
const CONFIRM_ACTIONS = new Set<CasaActionType>(["stop", "restart", "kill"]);

interface UseCasaActionResult {
  acting: boolean;
  actionError: string | null;
  busyWarning: BusyWarning | null;
  /** Non-null when waiting for user confirmation (stop/restart/kill). */
  pendingConfirm: CasaActionType | null;
  handleAction: (action: CasaActionType, opts?: { force?: boolean }) => Promise<void>;
  confirmAction: () => Promise<void>;
  dismissConfirm: () => void;
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
  const [pendingConfirm, setPendingConfirm] = useState<CasaActionType | null>(null);
  const { authHeaders, logout } = useAuth();

  const executeAction = useCallback(async (action: CasaActionType, opts?: { force?: boolean }) => {
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

  const handleAction = useCallback(async (action: CasaActionType, opts?: { force?: boolean }) => {
    if (CONFIRM_ACTIONS.has(action) && !opts?.force) {
      setPendingConfirm(action);
      return;
    }
    await executeAction(action, opts);
  }, [executeAction]);

  const confirmAction = useCallback(async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm;
    setPendingConfirm(null);
    await executeAction(action);
  }, [pendingConfirm, executeAction]);

  const dismissConfirm = useCallback(() => {
    setPendingConfirm(null);
  }, []);

  const confirmForce = useCallback(async () => {
    if (!busyWarning) return;
    const action = busyWarning.pendingAction;
    setBusyWarning(null);
    await executeAction(action, { force: true });
  }, [busyWarning, executeAction]);

  const dismissBusy = useCallback(() => {
    setBusyWarning(null);
  }, []);

  return { acting, actionError, busyWarning, pendingConfirm, handleAction, confirmAction, dismissConfirm, confirmForce, dismissBusy };
}
