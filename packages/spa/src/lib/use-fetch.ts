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
 * optional polling interval, and automatic Bearer token injection.
 */
export function useFetch<T>(url: string, opts: UseFetchOptions = {}): UseFetchResult<T> {
  const { interval, deps = [] } = opts;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { authHeaders, logout } = useAuth();

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
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
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!controller.signal.aborted) setError("Failed to connect to server");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, authHeaders, logout, ...deps]);

  useEffect(() => {
    let cancelled = false;
    fetchData();

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (interval && interval > 0) {
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
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}
