"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

export function MechaInspect({ mechaId }: { mechaId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const fetchInspect = useCallback(async (forceRefresh = false) => {
    if (data && !forceRefresh) {
      setOpen((o) => !o);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/mechas/${mechaId}/inspect`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      const json = await res.json();
      setData(JSON.stringify(json, null, 2));
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [mechaId, data]);

  const copyToClipboard = useCallback(() => {
    if (!data) return;
    navigator.clipboard.writeText(data).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);

  return (
    <div>
      <div className="flex gap-2 items-center">
        <Button
          variant="outline"
          size="xs"
          onClick={() => fetchInspect()}
          disabled={loading}
        >
          {loading ? "Loading..." : open ? "Hide raw JSON" : "Show raw JSON"}
        </Button>
        {open && data && (
          <>
            <Button variant="outline" size="xs" onClick={copyToClipboard}>
              {copied ? "Copied!" : "Copy"}
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => fetchInspect(true)}
              disabled={loading}
            >
              Refresh
            </Button>
          </>
        )}
      </div>
      {error && (
        <p className="text-sm text-destructive mt-2">{error}</p>
      )}
      {open && data && (
        <pre className="mt-2 p-3 text-xs font-mono bg-background border border-border rounded-md overflow-auto max-h-96 whitespace-pre-wrap break-all text-foreground">
          {data}
        </pre>
      )}
    </div>
  );
}
