"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDashboardStore } from "@/lib/store";

export function CreateMechaForm() {
  const router = useRouter();
  const setSelectedMechaId = useDashboardStore((s) => s.setSelectedMechaId);
  const [createPath, setCreatePath] = useState("");
  const [claudeToken, setClaudeToken] = useState("");
  const [otp, setOtp] = useState("");
  const [permissionMode, setPermissionMode] = useState("default");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!createPath.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/mechas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: createPath.trim(),
          ...(claudeToken && { claudeToken }),
          ...(otp && { otp }),
          ...(permissionMode !== "default" && { permissionMode }),
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? `Error ${res.status}`);
        return;
      }
      const result = await res.json() as { id: string };
      setSelectedMechaId(result.id);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-full items-start justify-center p-6 md:p-12">
      <div className="w-full max-w-lg">
        <h1 className="text-xl font-semibold mb-1">Create New Mecha</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Spin up a new CASA instance from a project directory.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="path">Project Path</Label>
            <Input
              id="path"
              type="text"
              value={createPath}
              onChange={(e) => setCreatePath(e.target.value)}
              placeholder="/path/to/project"
              disabled={creating}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="claude-token">Claude Setup Token</Label>
            <Input
              id="claude-token"
              type="password"
              value={claudeToken}
              onChange={(e) => setClaudeToken(e.target.value)}
              placeholder="Leave empty to use host default"
              disabled={creating}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="otp">OTP Secret</Label>
            <Input
              id="otp"
              type="password"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="Leave empty to use host default"
              disabled={creating}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="permission-mode">Permission Mode</Label>
            <Select value={permissionMode} onValueChange={setPermissionMode} disabled={creating}>
              <SelectTrigger id="permission-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">default</SelectItem>
                <SelectItem value="plan">plan</SelectItem>
                <SelectItem value="full-auto">full-auto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={creating || !createPath.trim()}>
              {creating ? "Creating..." : "Create Mecha"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push("/")}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
