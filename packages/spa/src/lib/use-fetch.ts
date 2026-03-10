import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/auth-context";

interface UseFetchOptions {
  /** Polling interval in ms. Omit for one-shot fetch. */
  interval?: number;
  /** Additional dependencies that trigger re-fetch. */
  deps?: unknown[];
}

interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Shared data fetching hook with loading/error state, abort on unmount,
 * optional polling interval, and automatic session cookie auth.
 *
 * Pass `null` as URL to skip fetching (useful for conditional polling).
 */
export function useFetch<T>(url: string | null, opts: UseFetchOptions = {}): UseFetchResult<T> {
  const { interval, deps = [] } = opts;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasDataRef = useRef(false);
  const { authHeaders, logout } = useAuth();

  // Stabilize deps as a JSON string to avoid recreating fetchData on every render.
  // deps should always be simple primitives; fallback prevents crash on circular refs.
  let depsKey: string;
  try { depsKey = JSON.stringify(deps); } catch { depsKey = String(deps); }

  const fetchData = useCallback(async () => {
    if (!url) {
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Only show loading spinner on initial fetch, not on background polls
    if (!hasDataRef.current) setLoading(true);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: authHeaders, credentials: "include" });
      if (controller.signal.aborted) return;
      if (res.status === 401) {
        logout();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        if (!controller.signal.aborted) setError(body.error ?? "Request failed");
        return;
      }
      const result = await res.json();
      if (!controller.signal.aborted) {
        setData(result);
        setError(null);
        hasDataRef.current = true;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!controller.signal.aborted) setError("Failed to connect to server");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [url, authHeaders, logout, depsKey]);

  useEffect(() => {
    let cancelled = false;
    hasDataRef.current = false;
    // Clear stale data when deps change to prevent flash of old content
    setData(null);
    setError(null);
    fetchData();

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (url && interval && interval > 0) {
      function scheduleNext() {
        if (cancelled) return;
        timer = setTimeout(async () => {
          if (cancelled) return;
          await fetchData();
          scheduleNext();
        }, interval);
      }
      scheduleNext();
    }

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [fetchData, interval, url]);

  return { data, loading, error, refetch: fetchData };
}
