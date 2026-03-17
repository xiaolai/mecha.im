import { useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode, KeyboardEvent } from "react";
import { Alert, Card } from "../components";
import { PixelOffice } from "../pixel-engine/components/PixelOffice";

interface LoginGateProps {
  children: ReactNode;
}

function TotpInput({ onComplete, error, busy }: { onComplete: (code: string) => void; error: string | null; busy: boolean }) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (error) {
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    }
  }, [error]);

  useEffect(() => { inputRefs.current[0]?.focus(); }, []);

  function handleChange(index: number, value: string) {
    if (value.length > 1) {
      const pasted = value.replace(/\D/g, "").slice(0, 6);
      if (pasted.length === 6) {
        const newDigits = pasted.split("");
        setDigits(newDigits);
        inputRefs.current[5]?.focus();
        onComplete(pasted);
        return;
      }
    }

    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    const code = newDigits.join("");
    if (code.length === 6 && newDigits.every(d => d !== "")) {
      onComplete(code);
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      const newDigits = [...digits];
      newDigits[index - 1] = "";
      setDigits(newDigits);
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const newDigits = pasted.split("");
      setDigits(newDigits);
      inputRefs.current[5]?.focus();
      onComplete(pasted);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-2" onPaste={handlePaste}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            value={digit}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onFocus={e => e.target.select()}
            disabled={busy}
            className={[
              "w-11 h-14 text-center text-2xl font-mono rounded-lg border transition-colors",
              "bg-card/80 backdrop-blur-sm text-foreground outline-none",
              "focus:border-primary focus:ring-1 focus:ring-primary",
              error ? "border-destructive" : "border-border",
              busy ? "opacity-50" : "",
            ].join(" ")}
          />
        ))}
      </div>

      {busy && (
        <p className="text-sm text-muted-foreground animate-pulse">Verifying...</p>
      )}

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
}

export default function LoginGate({ children }: LoginGateProps) {
  const [status, setStatus] = useState<"checking" | "open" | "locked" | "authenticated">("checking");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checkStatus = useCallback(() => {
    fetch("/api/totp/status", { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) { setStatus("locked"); return; }
        return r.json();
      })
      .then((data: { enabled?: boolean } | undefined) => {
        if (!data) return;
        setTotpEnabled(!!data.enabled);
        return fetch("/api/session", { credentials: "same-origin" }).then((r) => {
          if (r.ok) {
            setStatus("authenticated");
          } else {
            setStatus("locked");
          }
        });
      })
      .catch(() => setStatus("locked"));
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  async function handleVerify(code: string) {
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

  // Locked — show pixel office as background with login overlay
  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {/* Pixel office background (read-only, no controls) */}
      <div className="absolute inset-0">
        <PixelOffice isActive readOnly />
      </div>

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />

      {/* Login card */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-full max-w-sm px-4">
          <Card spacing={4} className="text-center bg-card/90 backdrop-blur-md shadow-2xl">
            <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl mx-auto">
              M
            </div>

            {totpEnabled ? (
              <TotpInput onComplete={handleVerify} error={error} busy={busy} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Access denied.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
