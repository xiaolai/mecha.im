import { useState, useCallback, useEffect, useRef } from "react";
import { KeyRoundIcon, ShieldCheckIcon, LoaderIcon } from "lucide-react";
import { useAuth } from "@/auth-context";

type Tab = "totp" | "apikey";

const TOTP_LENGTH = 6;
const API_KEY_MIN_LENGTH = 32;
const API_KEY_DEBOUNCE_MS = 300;

const EMPTY_DIGITS = Array.from({ length: TOTP_LENGTH }, () => "");

export function LoginPage() {
  const { setApiKey, setTotpAuthenticated, availableMethods, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab | null>(null);
  const [digits, setDigits] = useState<string[]>(EMPTY_DIGITS);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const submittingRef = useRef(false);
  const lastSubmittedKeyRef = useRef("");

  // Sync tab to server-reported methods once fetched
  useEffect(() => {
    if (tab !== null) return;
    if (availableMethods.totp) setTab("totp");
    else if (availableMethods.apiKey) setTab("apikey");
  }, [availableMethods, tab]);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authUnavailable, setAuthUnavailable] = useState(false);

  // Detect when auth methods loaded but none available
  useEffect(() => {
    if (authLoading || tab !== null) return;
    if (!availableMethods.totp && !availableMethods.apiKey) {
      setAuthUnavailable(true);
    }
  }, [authLoading, availableMethods, tab]);

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

  const submitApiKey = useCallback(async (apiKey: string) => {
    const trimmed = apiKey.trim();
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
        setError("Authentication failed");
      }
    } catch {
      setError("Cannot connect to server. Is the agent running?");
    } finally {
      setLoading(false);
    }
  }, [setApiKey]);

  // API key auto-submit: debounce after reaching min length, only on key change
  useEffect(() => {
    const trimmed = key.trim();
    if (tab !== "apikey" || trimmed.length < API_KEY_MIN_LENGTH) return;
    if (trimmed === lastSubmittedKeyRef.current) return;

    const timer = setTimeout(() => {
      lastSubmittedKeyRef.current = trimmed;
      submitApiKey(key);
    }, API_KEY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, tab, submitApiKey]);

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

  const bothAvailable = availableMethods.totp && availableMethods.apiKey;

  // Show error state when no auth methods available
  if (authUnavailable) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-destructive">No authentication methods available</p>
          <button
            onClick={() => { setAuthUnavailable(false); window.location.reload(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

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
              onClick={() => { setTab("totp"); setError(null); setDigits([...EMPTY_DIGITS]); }}
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
          ) : (
            <input
              type="password"
              placeholder="API Key"
              value={key}
              onChange={(e) => { setKey(e.target.value); setError(null); }}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring sm:h-9"
              disabled={loading}
              autoFocus
            />
          )}
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
