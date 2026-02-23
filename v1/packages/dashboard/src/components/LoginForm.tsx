"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Login failed");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const isDisabled = code.length !== 6 || loading;

  return (
    <div className="flex items-center justify-center min-h-dvh">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 w-80 p-8 rounded-xl bg-card border border-border"
      >
        <h1 className="text-xl font-semibold text-center">
          Mecha Dashboard
        </h1>
        <p className="text-sm text-muted-foreground text-center">
          Enter your 6-digit TOTP code
        </p>

        <label htmlFor="totp-code" className="sr-only">
          TOTP code
        </label>
        <input
          id="totp-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          aria-label="6-digit TOTP code"
          autoFocus
          className="px-4 py-3 text-2xl text-center tracking-widest rounded-lg border border-border bg-background text-foreground outline-none"
        />

        {error && (
          <p className="text-destructive text-sm text-center">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={isDisabled}
        >
          {loading ? "Verifying..." : "Login"}
        </Button>
      </form>
    </div>
  );
}
