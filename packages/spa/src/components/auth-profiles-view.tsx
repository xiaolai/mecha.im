import { useState } from "react";
import { PlusIcon, Loader2Icon, Trash2Icon, StarIcon, ZapIcon, CheckCircleIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

interface AuthProfile {
  name: string;
  type: "oauth" | "api-key";
  isDefault: boolean;
  source: "store" | "env";
}

type TestResult = { valid: boolean; error?: string } | null;

export function AuthProfilesView() {
  const { data: profiles, loading, error, refetch } = useFetch<AuthProfile[]>("/settings/auth-profiles");
  const { authHeaders } = useAuth();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"api-key" | "oauth">("api-key");
  const [token, setToken] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  async function handleCreate() {
    if (!name || !token) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/settings/auth-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ name, type, token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setCreateError(body.error ?? "Request failed");
        return;
      }
      setName("");
      setToken("");
      setShowForm(false);
      refetch();
    } finally {
      setCreating(false);
    }
  }

  async function handleTest(profileName: string) {
    setTesting((prev) => ({ ...prev, [profileName]: true }));
    setTestResults((prev) => ({ ...prev, [profileName]: null }));
    try {
      const res = await fetch(`/settings/auth-profiles/${encodeURIComponent(profileName)}/test`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
      });
      const body = await res.json();
      setTestResults((prev) => ({ ...prev, [profileName]: body }));
    } catch {
      setTestResults((prev) => ({ ...prev, [profileName]: { valid: false, error: "Connection failed" } }));
    } finally {
      setTesting((prev) => ({ ...prev, [profileName]: false }));
    }
  }

  async function handleSetDefault(profileName: string) {
    await fetch("/settings/auth-profiles/default", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      credentials: "include",
      body: JSON.stringify({ name: profileName }),
    });
    refetch();
  }

  async function handleDelete(profileName: string) {
    await fetch(`/settings/auth-profiles/${encodeURIComponent(profileName)}`, {
      method: "DELETE",
      headers: authHeaders,
      credentials: "include",
    });
    refetch();
  }

  if (loading && !profiles) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Add profile toggle */}
      {!showForm && (
        <div>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <PlusIcon className="size-4" />
            Add Profile
          </Button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-profile"
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as "api-key" | "oauth")}
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="api-key">api-key</option>
                <option value="oauth">oauth</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-medium text-muted-foreground">Token</label>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="sk-ant-..."
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          {createError && (
            <p className="text-sm text-destructive">{createError}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={!name || !token || creating} onClick={handleCreate} className="h-11 sm:h-9">
              {creating ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setCreateError(null); }} className="h-11 sm:h-9">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Profiles table */}
      {(!profiles || profiles.length === 0) ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No auth profiles configured.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => {
                const result = testResults[profile.name];
                return (
                  <TableRow key={profile.name}>
                    <TableCell className="font-mono text-sm">
                      <span className="flex items-center gap-1.5">
                        {profile.name}
                        {profile.isDefault && (
                          <Badge variant="secondary" className="text-xs">default</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{profile.type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{profile.source}</TableCell>
                    <TableCell>
                      {result ? (
                        result.valid ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <CheckCircleIcon className="size-3" /> Valid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <XCircleIcon className="size-3" /> {result.error ?? "Invalid"}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <TooltipIconButton
                          tooltip="Test"
                          variant="ghost"
                          size="icon-sm"
                          disabled={testing[profile.name]}
                          onClick={() => handleTest(profile.name)}
                        >
                          {testing[profile.name] ? <Loader2Icon className="size-4 animate-spin" /> : <ZapIcon className="size-4" />}
                        </TooltipIconButton>
                        {!profile.isDefault && (
                          <TooltipIconButton
                            tooltip="Set as default"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleSetDefault(profile.name)}
                          >
                            <StarIcon className="size-4" />
                          </TooltipIconButton>
                        )}
                        {profile.source !== "env" && (
                          <TooltipIconButton
                            tooltip="Delete"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDelete(profile.name)}
                          >
                            <Trash2Icon className="size-4" />
                          </TooltipIconButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
