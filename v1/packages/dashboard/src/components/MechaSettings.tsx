"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function MechaSettings({ mechaId }: { mechaId: string }) {
  const router = useRouter();
  const [claudeToken, setClaudeToken] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [otp, setOtp] = useState("");
  const [permissionMode, setPermissionMode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const hasInput = claudeToken || anthropicApiKey || otp || permissionMode;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasInput) return;

    setLoading(true);
    setMessage(null);

    const body: Record<string, string> = {};
    if (claudeToken) body.claudeToken = claudeToken;
    if (anthropicApiKey) body.anthropicApiKey = anthropicApiKey;
    if (otp) body.otp = otp;
    if (permissionMode) body.permissionMode = permissionMode;

    try {
      const res = await fetch(`/api/mechas/${mechaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setMessage({ type: "error", text: data.error ?? `HTTP ${res.status}` });
        return;
      }

      setMessage({ type: "success", text: "Updated — container recreated" });
      setClaudeToken("");
      setAnthropicApiKey("");
      setOtp("");
      setPermissionMode("");
      router.refresh();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full px-3 py-2 text-sm font-mono rounded-md border border-border bg-background text-foreground outline-none";

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 mb-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Claude Setup Token</label>
          <input
            type="password"
            placeholder="Leave empty to keep current"
            value={claudeToken}
            onChange={(e) => setClaudeToken(e.target.value)}
            className={inputCls}
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Anthropic API Key</label>
          <input
            type="password"
            placeholder="Leave empty to keep current"
            value={anthropicApiKey}
            onChange={(e) => setAnthropicApiKey(e.target.value)}
            className={inputCls}
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">OTP Secret</label>
          <input
            type="password"
            placeholder="Leave empty to keep current"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            className={inputCls}
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Permission Mode</label>
          <select
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value)}
            className={inputCls}
            disabled={loading}
          >
            <option value="">Keep current</option>
            <option value="default">default</option>
            <option value="plan">plan</option>
            <option value="full-auto">full-auto</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={!hasInput || loading}
        >
          {loading ? "Updating..." : "Update"}
        </Button>

        {message && (
          <span className={`text-sm ${
            message.type === "success" ? "text-success" : "text-destructive"
          }`}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}
