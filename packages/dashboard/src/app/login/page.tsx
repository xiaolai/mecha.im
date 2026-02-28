"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheckIcon, LoaderIcon } from "lucide-react";

const DIGITS = 6;

export default function LoginPage() {
  const [code, setCode] = useState<string[]>(Array(DIGITS).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lockoutMs, setLockoutMs] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const router = useRouter();

  const handleChange = useCallback(
    (index: number, value: string) => {
      if (!/^\d?$/.test(value)) return;
      const next = [...code];
      next[index] = value;
      setCode(next);
      setError(null);

      if (value && index < DIGITS - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [code],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === "Backspace" && !code[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [code],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, DIGITS);
      if (!pasted) return;
      const next = [...code];
      for (let i = 0; i < pasted.length; i++) {
        next[i] = pasted[i] ?? "";
      }
      setCode(next);
      const focusIdx = Math.min(pasted.length, DIGITS - 1);
      inputRefs.current[focusIdx]?.focus();
    },
    [code],
  );

  const submit = useCallback(async () => {
    const joined = code.join("");
    if (joined.length !== DIGITS) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joined }),
      });

      if (res.ok) {
        router.push("/");
        return;
      }

      const data = (await res.json()) as { error?: string; retryAfterMs?: number };

      if (res.status === 429 && data.retryAfterMs) {
        setLockoutMs(data.retryAfterMs);
        setError(`Too many attempts. Try again in ${Math.ceil(data.retryAfterMs / 1000)}s.`);
        setTimeout(() => setLockoutMs(0), data.retryAfterMs);
      } else {
        setError(data.error ?? "Invalid code");
      }

      setCode(Array(DIGITS).fill(""));
      inputRefs.current[0]?.focus();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [code, router]);

  const isComplete = code.every((d) => d !== "");

  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
      <div className="mb-6 flex flex-col items-center gap-2">
        <ShieldCheckIcon className="size-8 text-primary" />
        <h1 className="text-lg font-semibold text-foreground">Dashboard Login</h1>
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code from your authenticator app
        </p>
      </div>

      <div className="mb-4 flex justify-center gap-2" onPaste={handlePaste}>
        {code.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className="h-12 w-10 rounded-md border border-input bg-background text-center text-lg font-mono text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring sm:h-10"
            disabled={loading || lockoutMs > 0}
            autoFocus={i === 0}
          />
        ))}
      </div>

      {error && (
        <p className="mb-4 text-center text-sm text-destructive">{error}</p>
      )}

      <button
        onClick={submit}
        disabled={!isComplete || loading || lockoutMs > 0}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {loading && <LoaderIcon className="size-4 animate-spin" />}
        {loading ? "Verifying..." : "Verify"}
      </button>
    </div>
  );
}
