import { useState, useCallback, useEffect } from "react";
import { KeyRoundIcon, ShieldCheckIcon, LoaderIcon } from "lucide-react";
import { useAuth } from "@/auth-context";

type Tab = "totp" | "apikey";

export function LoginPage() {
  const { setApiKey, setTotpAuthenticated, availableMethods, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab | null>(null);
  const [code, setCode] = useState("");

  // Sync tab to server-reported methods once fetched
  useEffect(() => {
    if (tab !== null) return;
    if (availableMethods.totp) setTab("totp");
    else if (availableMethods.apiKey) setTab("apikey");
  }, [availableMethods, tab]);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submitTotp = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: trimmed }),
      });

      if (res.ok) {
        setTotpAuthenticated();
        return;
      }

      const body = await res.json().catch(() => ({ error: "Request failed" }));
      if (res.status === 429) {
        const retry = body.retryAfterMs ? ` (retry in ${Math.ceil(body.retryAfterMs / 1000)}s)` : "";
        setError(`Too many attempts${retry}`);
      } else {
        setError(body.error ?? "Invalid code");
      }
    } catch {
      setError("Cannot connect to server. Is the agent running?");
    } finally {
      setLoading(false);
    }
  }, [code, setTotpAuthenticated]);

  const submitApiKey = useCallback(async () => {
    const trimmed = key.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/casas", {
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

  const bothAvailable = availableMethods.totp && availableMethods.apiKey;

  if (authLoading || tab === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex flex-col items-center gap-2">
          {tab === "totp"
            ? <ShieldCheckIcon className="size-8 text-primary" />
            : <KeyRoundIcon className="size-8 text-primary" />}
          <h1 className="text-lg font-semibold text-foreground">Dashboard Login</h1>
          {tab === "totp" && (
            <p className="text-sm text-muted-foreground text-center">
              Enter the 6-digit code from your authenticator app
            </p>
          )}
          {tab === "apikey" && (
            <p className="text-sm text-muted-foreground text-center">
              Enter your <code className="font-mono text-xs">MECHA_AGENT_API_KEY</code> to connect
            </p>
          )}
        </div>

        {bothAvailable && (
          <div className="mb-4 flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => { setTab("totp"); setError(null); }}
              className={`flex-1 px-3 py-1.5 text-sm font-medium ${tab === "totp" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              TOTP
            </button>
            <button
              onClick={() => { setTab("apikey"); setError(null); }}
              className={`flex-1 px-3 py-1.5 text-sm font-medium ${tab === "apikey" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              API Key
            </button>
          </div>
        )}

        <div className="mb-4">
          {tab === "totp" ? (
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitTotp(); }}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-center text-lg font-mono tracking-widest text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring sm:h-9"
              disabled={loading}
              autoFocus
            />
          ) : (
            <input
              type="password"
              placeholder="API Key"
              value={key}
              onChange={(e) => { setKey(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitApiKey(); }}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring sm:h-9"
              disabled={loading}
              autoFocus
            />
          )}
        </div>

        {error && (
          <p className="mb-4 text-center text-sm text-destructive">{error}</p>
        )}

        <button
          onClick={tab === "totp" ? submitTotp : submitApiKey}
          disabled={(tab === "totp" ? !code.trim() : !key.trim()) || loading}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-auto sm:ml-auto"
        >
          {loading && <LoaderIcon className="size-4 animate-spin" />}
          {loading ? "Verifying..." : "Connect"}
        </button>
      </div>
    </div>
  );
}
