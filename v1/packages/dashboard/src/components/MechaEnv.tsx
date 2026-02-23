"use client";

import { useCallback, useEffect, useState } from "react";

interface EnvEntry {
  key: string;
  value: string;
}

export function MechaEnv({ mechaId }: { mechaId: string }) {
  const [env, setEnv] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);

  const fetchEnv = useCallback(async () => {
    setError("");
    try {
      const url = `/api/mechas/${mechaId}/env${showSecrets ? "?showSecrets=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      const data = await res.json() as { env: EnvEntry[] };
      setEnv(data.env);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [mechaId, showSecrets]);

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading environment...</p>;
  }

  return (
    <div>
      {error && (
        <p className="text-destructive text-sm mb-2">
          {error}
          <button
            onClick={() => { setError(""); fetchEnv(); }}
            className="ml-2 bg-transparent border-none text-primary cursor-pointer text-sm"
          >Retry</button>
        </p>
      )}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 cursor-pointer">
        <input
          type="checkbox"
          checked={showSecrets}
          onChange={(e) => setShowSecrets(e.target.checked)}
        />
        Show secrets
      </label>
      {env.length === 0 ? (
        <p className="text-muted-foreground text-sm">No environment variables.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-muted-foreground font-medium">Key</th>
                <th className="px-3 py-2 text-left text-muted-foreground font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {env.map((e) => (
                <tr key={e.key} className="border-b border-border">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{e.key}</td>
                  <td className={`px-3 py-2 font-mono max-w-[400px] overflow-hidden text-ellipsis whitespace-nowrap ${
                    e.value === "***" ? "text-muted-foreground" : "text-foreground"
                  }`}>{e.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
