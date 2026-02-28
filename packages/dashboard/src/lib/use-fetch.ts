"use client";

import { useEffect, useState, useCallback, useRef } from "react";

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
 * and optional polling interval.
 */
export function useFetch<T>(url: string, opts: UseFetchOptions = {}): UseFetchResult<T> {
  const { interval, deps = [] } = opts;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        if (activeRef.current) setError(body.error ?? "Request failed");
        return;
      }
      const result = await res.json();
      if (activeRef.current) {
        setData(result);
        setError(null);
      }
    } catch {
      if (activeRef.current) setError("Failed to connect to server");
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [url, ...deps]);

  useEffect(() => {
    activeRef.current = true;
    fetchData();

    let timer: ReturnType<typeof setInterval> | undefined;
    if (interval && interval > 0) {
      timer = setInterval(fetchData, interval);
    }

    return () => {
      activeRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}
