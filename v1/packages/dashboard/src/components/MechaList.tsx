"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PruneButton } from "./PruneButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Mecha {
  id: string;
  name: string;
  state: string;
  path: string;
  ports: Array<{ PublicPort?: number }>;
}

// Mirrors PRUNABLE_STATES in @mecha/service — used for UI-only prunable count
const PRUNABLE_STATES = new Set(["exited", "dead", "created"]);

export function MechaList() {
  const [mechas, setMechas] = useState<Mecha[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createPath, setCreatePath] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [claudeToken, setClaudeToken] = useState("");
  const [otp, setOtp] = useState("");
  const [permissionMode, setPermissionMode] = useState("default");
  const [actionError, setActionError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removeWithState, setRemoveWithState] = useState(false);

  const fetchMechas = useCallback(async () => {
    try {
      const res = await fetch("/api/mechas");
      if (res.ok) setMechas(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMechas();
    let interval = setInterval(fetchMechas, 5000);

    // Pause polling when tab is hidden
    function onVisibilityChange() {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        fetchMechas();
        interval = setInterval(fetchMechas, 5000);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchMechas]);

  async function action(id: string, act: string, method = "POST") {
    setActing(id);
    setActionError("");
    try {
      const res = await fetch(`/api/mechas/${id}/${act}`, { method });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setActionError(data.error ?? `Action failed (${res.status})`);
      }
      await fetchMechas();
    } finally {
      setActing(null);
    }
  }

  async function removeMecha(id: string, withState: boolean) {
    setConfirmRemove(null);
    setRemoveWithState(false);
    setActing(id);
    setActionError("");
    try {
      const url = `/api/mechas/${id}${withState ? "?withState=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setActionError(data.error ?? `Remove failed (${res.status})`);
      }
      await fetchMechas();
    } finally {
      setActing(null);
    }
  }

  async function createMecha(e: React.FormEvent) {
    e.preventDefault();
    if (!createPath.trim()) return;
    setCreating(true);
    setCreateError("");
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
        setCreateError(data.error ?? `Error ${res.status}`);
        return;
      }
      setCreatePath("");
      setClaudeToken("");
      setOtp("");
      setPermissionMode("default");
      setShowCreate(false);
      await fetchMechas();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <p className="text-muted-foreground p-5">Loading...</p>;
  }

  const prunableCount = mechas.filter((m) => PRUNABLE_STATES.has(m.state)).length;

  const inputCls = "flex-1 px-2.5 py-1.5 text-sm font-mono rounded border border-border bg-background text-foreground outline-none";

  const createForm = showCreate && (
    <form onSubmit={createMecha} className="flex flex-col gap-2 p-3 mb-3 rounded-lg border border-border bg-card">
      <div className="flex gap-2 items-center">
        <label htmlFor="create-path" className="text-sm text-muted-foreground whitespace-nowrap min-w-28">Project path:</label>
        <input
          id="create-path"
          type="text"
          value={createPath}
          onChange={(e) => setCreatePath(e.target.value)}
          placeholder="/path/to/project"
          disabled={creating}
          className={inputCls}
        />
      </div>
      <div className="flex gap-2 items-center">
        <label htmlFor="create-claude-token" className="text-sm text-muted-foreground whitespace-nowrap min-w-28">Claude Setup Token:</label>
        <input
          id="create-claude-token"
          type="password"
          value={claudeToken}
          onChange={(e) => setClaudeToken(e.target.value)}
          placeholder="Leave empty to use host default"
          disabled={creating}
          className={inputCls}
        />
      </div>
      <div className="flex gap-2 items-center">
        <label htmlFor="create-otp" className="text-sm text-muted-foreground whitespace-nowrap min-w-28">OTP Secret:</label>
        <input
          id="create-otp"
          type="password"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          placeholder="Leave empty to use host default"
          disabled={creating}
          className={inputCls}
        />
      </div>
      <div className="flex gap-2 items-center">
        <label htmlFor="create-permission-mode" className="text-sm text-muted-foreground whitespace-nowrap min-w-28">Permission Mode:</label>
        <select
          id="create-permission-mode"
          value={permissionMode}
          onChange={(e) => setPermissionMode(e.target.value)}
          disabled={creating}
          className={`${inputCls} font-sans`}
        >
          <option value="default">default</option>
          <option value="plan">plan</option>
          <option value="full-auto">full-auto</option>
        </select>
      </div>
      <div className="flex gap-2 items-center justify-end">
        {createError && (
          <span className="text-xs text-destructive mr-auto">{createError}</span>
        )}
        <Button
          type="submit"
          disabled={creating || !createPath.trim()}
          size="sm"
        >
          {creating ? "Creating..." : "Create"}
        </Button>
      </div>
    </form>
  );

  if (mechas.length === 0) {
    return (
      <div>
        <div className="mb-4">
          <Button
            variant={showCreate ? "default" : "outline"}
            size="sm"
            onClick={() => setShowCreate(!showCreate)}
            className="border-primary text-primary"
          >
            {showCreate ? "Cancel" : "+ New Mecha"}
          </Button>
        </div>
        {createForm}
        <div className="py-10 px-5 text-center text-muted-foreground text-sm">
          No mechas found. Click &quot;+ New Mecha&quot; or use <code>mecha up &lt;path&gt;</code> to create one.
        </div>
      </div>
    );
  }

  const stateDotCls = (state: string) => {
    if (state === "running") return "bg-success";
    if (state === "exited" || state === "dead") return "bg-destructive";
    return "bg-warning";
  };

  return (
    <div>
      <div className="flex gap-2 items-center mb-3">
        <Button
          variant={showCreate ? "default" : "outline"}
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? "Cancel" : "+ New Mecha"}
        </Button>
        <PruneButton prunableCount={prunableCount} onPruned={fetchMechas} />
      </div>
      {createForm}
      <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {["ID", "State", "Port", "Path", "Actions"].map((h) => (
              <th key={h} className="px-3 py-2.5 text-left text-muted-foreground font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mechas.map((m) => {
            const port = m.ports.find((p) => p.PublicPort)?.PublicPort;
            const isActing = acting === m.id;
            const isRunning = m.state === "running";
            return (
              <tr key={m.name || m.id} className="border-b border-border">
                <td className="px-3 py-2.5">
                  <Link href={`/mechas/${m.id}`} className="font-mono">
                    {m.id}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${stateDotCls(m.state)}`} />
                    {m.state}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono">
                  {port ?? "\u2014"}
                </td>
                <td className="px-3 py-2.5 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground">
                  {m.path}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1.5">
                    {!isRunning && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={isActing}
                        onClick={() => action(m.id, "start")}
                        className="border-success text-success hover:bg-success/10"
                      >Start</Button>
                    )}
                    {isRunning && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={isActing}
                        onClick={() => action(m.id, "stop")}
                        className="border-warning text-warning hover:bg-warning/10"
                      >Stop</Button>
                    )}
                    {isRunning && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={isActing}
                        onClick={() => action(m.id, "restart")}
                      >Restart</Button>
                    )}
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={isActing}
                      onClick={() => setConfirmRemove(m.id)}
                      className="border-destructive text-destructive hover:bg-destructive/10"
                    >Remove</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {actionError && (
        <div className="mt-2 px-3 py-2 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError("")}
            className="bg-transparent border-none text-destructive cursor-pointer text-base"
          >&times;</button>
        </div>
      )}

      <Dialog open={!!confirmRemove} onOpenChange={(open) => { if (!open) { setConfirmRemove(null); setRemoveWithState(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Mecha</DialogTitle>
            <DialogDescription>
              Remove <code className="text-foreground">{confirmRemove}</code>? This will delete the container.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={removeWithState}
              onChange={(e) => setRemoveWithState(e.target.checked)}
            />
            Also remove state volume
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmRemove(null); setRemoveWithState(false); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRemove && removeMecha(confirmRemove, removeWithState)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
