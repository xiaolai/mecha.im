import { useState, useEffect, useCallback } from "react";
import type { ReactNode, ChangeEvent, KeyboardEvent } from "react";
import { Button, Input, Alert, Card } from "../components";

interface LoginGateProps {
  children: ReactNode;
}

export default function LoginGate({ children }: LoginGateProps) {
  const [status, setStatus] = useState<"checking" | "open" | "locked" | "authenticated">("checking");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checkStatus = useCallback(() => {
    fetch("/api/totp/status", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data: { enabled?: boolean }) => {
        if (!data.enabled) {
          setStatus("open");
          return;
        }
        // TOTP enabled — check if we already have a valid session
        return fetch("/api/session", { credentials: "same-origin" }).then((r) => {
          setStatus(r.ok ? "authenticated" : "locked");
        });
      })
      .catch(() => setStatus("open"));
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  async function handleVerify() {
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code }),
      });
      if (resp.ok) {
        setStatus("authenticated");
      } else {
        const data = await resp.json() as { error?: string };
        setError(data.error ?? "Invalid code");
        setCode("");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (status === "open" || status === "authenticated") {
    return <>{children}</>;
  }

  // Locked — show login
  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        <Card spacing={4} className="text-center">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl mx-auto">
            M
          </div>
          <h1 className="text-lg font-semibold text-foreground">Mecha Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app.
          </p>

          <Input
            mono
            value={code}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
            }}
            onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") handleVerify(); }}
            placeholder="000000"
            className="w-full text-center text-2xl tracking-[0.5em]"
            autoComplete="one-time-code"
            inputMode="numeric"
            autoFocus
          />

          {error && <Alert variant="error">{error}</Alert>}

          <Button
            variant="primary"
            size="lg"
            onClick={handleVerify}
            disabled={code.length !== 6 || busy}
            className="w-full"
          >
            {busy ? "Verifying..." : "Verify"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
