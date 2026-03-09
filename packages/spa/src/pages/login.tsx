import { useState, useCallback, useRef } from "react";
import { LoaderIcon } from "lucide-react";
import { useAuth } from "@/auth-context";

const TOTP_LENGTH = 6;

const EMPTY_DIGITS = Array.from({ length: TOTP_LENGTH }, () => "");

/** TOTP login page with 6-digit code input and auto-submit. */
export function LoginPage() {
  const { setTotpAuthenticated, availableMethods, loading: authLoading } = useAuth();
  const [digits, setDigits] = useState<string[]>(EMPTY_DIGITS);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const submittingRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submitTotp = useCallback(async (code: string) => {
    if (!code || code.length !== TOTP_LENGTH) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });

      if (res.ok) {
        setTotpAuthenticated();
        return;
      }

      const body = await res.json().catch(() => ({ error: "Request failed" }));
      if (res.status === 429) {
        const retryMs = body.retryAfterMs;
        const retry = typeof retryMs === "number" && Number.isFinite(retryMs)
          ? ` (retry in ${Math.ceil(retryMs / 1000)}s)`
          : "";
        setError(`Too many attempts${retry}`);
      } else {
        setError("Invalid code");
      }
      // Clear digits and refocus first input on error
      setDigits([...EMPTY_DIGITS]);
      setTimeout(() => inputRefs.current[0]?.focus(), 0);
    } catch {
      setError("Cannot connect to server. Is the agent running?");
      setDigits([...EMPTY_DIGITS]);
      setTimeout(() => inputRefs.current[0]?.focus(), 0);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }, [setTotpAuthenticated]);

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setError(null);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);

    if (digit && index < TOTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits filled
    if (digit) {
      const code = next.join("");
      if (code.length === TOTP_LENGTH) submitTotp(code);
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, TOTP_LENGTH);
    if (!pasted) return;

    const next = [...EMPTY_DIGITS];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
    setDigits(next);
    setError(null);

    const focusIndex = Math.min(pasted.length, TOTP_LENGTH - 1);
    setTimeout(() => inputRefs.current[focusIndex]?.focus(), 0);

    if (pasted.length === TOTP_LENGTH) {
      submitTotp(pasted);
    }
  };

  // Show error state when TOTP not available
  if (!authLoading && !availableMethods.totp) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-destructive">TOTP authentication not available</p>
          <button
            onClick={() => { window.location.reload(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src="/images/login-bg.png" alt="Mecha" className="size-48" />
          <h1 className="text-lg font-semibold text-foreground">Dashboard Login</h1>
          <p className="text-sm text-muted-foreground text-center">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-center gap-2">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleDigitKeyDown(i, e)}
                onPaste={handlePaste}
                className="size-11 rounded-md border border-input bg-background text-center text-lg font-mono text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring sm:size-9 disabled:opacity-50"
                disabled={loading}
                autoFocus={i === 0}
              />
            ))}
          </div>
        </div>

        {error && (
          <p className="mb-4 text-center text-sm text-destructive">{error}</p>
        )}

        {loading && (
          <div className="flex justify-center">
            <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
