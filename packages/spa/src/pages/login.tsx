import { useState, useCallback } from "react";
import { KeyRoundIcon, LoaderIcon } from "lucide-react";
import { useAuth } from "@/auth-context";

export function LoginPage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setApiKey } = useAuth();

  const submit = useCallback(async () => {
    const trimmed = key.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/healthz", {
        headers: { Authorization: `Bearer ${trimmed}` },
      });

      if (res.ok) {
        setApiKey(trimmed);
        return;
      }

      if (res.status === 401) {
        setError("Invalid API key");
      } else {
        setError(`Server returned ${res.status}`);
      }
    } catch {
      setError("Cannot connect to server. Is the agent running?");
    } finally {
      setLoading(false);
    }
  }, [key, setApiKey]);

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex flex-col items-center gap-2">
          <KeyRoundIcon className="size-8 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Dashboard Login</h1>
          <p className="text-sm text-muted-foreground text-center">
            Enter your <code className="font-mono text-xs">MECHA_AGENT_API_KEY</code> to connect
          </p>
        </div>

        <div className="mb-4">
          <input
            type="password"
            placeholder="API Key"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring sm:h-9"
            disabled={loading}
            autoFocus
          />
        </div>

        {error && (
          <p className="mb-4 text-center text-sm text-destructive">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={!key.trim() || loading}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-auto sm:ml-auto"
        >
          {loading && <LoaderIcon className="size-4 animate-spin" />}
          {loading ? "Verifying..." : "Connect"}
        </button>
      </div>
    </div>
  );
}
