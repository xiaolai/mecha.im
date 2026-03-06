import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/auth-context";
import { useFetch } from "@/lib/use-fetch";
import { Loader2Icon } from "lucide-react";
import type { AuthProfile } from "@/components/auth-switcher-panels";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function BotSpawnForm({ open, onOpenChange, onCreated }: Props) {
  const { authHeaders } = useAuth();
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [auth, setAuth] = useState("");
  const [tags, setTags] = useState("");
  const [sandbox, setSandbox] = useState("auto");
  const [permissionMode, setPermissionMode] = useState("default");
  const [model, setModel] = useState("");
  const [expose, setExpose] = useState("");
  const [meterOff, setMeterOff] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const { data: profiles } = useFetch<AuthProfile[]>(
    open ? "/auth/profiles" : null,
  );

  const nameError =
    touched.name && !/^[a-z0-9][a-z0-9-]*$/.test(name)
      ? "Lowercase letters, numbers, hyphens. Must start with letter or number."
      : null;
  const workspaceError =
    touched.workspace && workspace.length > 0 && !workspace.startsWith("/")
      ? "Must be an absolute path."
      : null;
  const canSubmit =
    name.length > 0 &&
    workspace.length > 0 &&
    !nameError &&
    !workspaceError &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Validate regardless of touch state on submit
    setTouched({ name: true, workspace: true });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return;
    if (workspace.length > 0 && !workspace.startsWith("/")) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const body: Record<string, unknown> = {
        name,
        workspacePath: workspace,
      };
      if (auth) body.auth = auth;
      if (tags) {
        body.tags = tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      }
      if (sandbox !== "auto") body.sandboxMode = sandbox;
      if (permissionMode !== "default") body.permissionMode = permissionMode;
      if (model) body.model = model;
      if (expose.trim()) {
        body.expose = expose
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      if (meterOff) body.meterOff = true;

      const res = await fetch("/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setServerError(
          (data as { error?: string }).error ?? `Error ${res.status}`,
        );
        return;
      }
      onCreated();
      onOpenChange(false);
      resetForm();
    } catch {
      setServerError("Connection error");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setName("");
    setWorkspace("");
    setAuth("");
    setTags("");
    setSandbox("auto");
    setPermissionMode("default");
    setModel("");
    setExpose("");
    setMeterOff(false);
    setTouched({});
    setServerError(null);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New Bot</SheetTitle>
          <SheetDescription>
            Spawn a new bot with the settings below.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-name">Name</Label>
            <Input
              id="spawn-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              placeholder="my-bot"
              className="h-11 sm:h-9"
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>

          {/* Workspace */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-workspace">Workspace</Label>
            <Input
              id="spawn-workspace"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, workspace: true }))}
              placeholder="/path/to/project"
              className="h-11 sm:h-9"
            />
            {workspaceError && (
              <p className="text-xs text-destructive">{workspaceError}</p>
            )}
          </div>

          {/* Auth Profile */}
          <div className="flex flex-col gap-1.5">
            <Label>Auth Profile</Label>
            <Select value={auth} onValueChange={setAuth}>
              <SelectTrigger className="h-11 sm:h-9">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                {profiles?.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name}
                    {p.isDefault ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-tags">Tags</Label>
            <Input
              id="spawn-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="web, backend"
              className="h-11 sm:h-9"
            />
            <p className="text-xs text-muted-foreground">Comma-separated</p>
          </div>

          {/* Sandbox + Permission Mode row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Sandbox</Label>
              <Select value={sandbox} onValueChange={setSandbox}>
                <SelectTrigger className="h-11 sm:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto</SelectItem>
                  <SelectItem value="off">off</SelectItem>
                  <SelectItem value="require">require</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Permission Mode</Label>
              <Select value={permissionMode} onValueChange={setPermissionMode}>
                <SelectTrigger className="h-11 sm:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">default</SelectItem>
                  <SelectItem value="plan">plan</SelectItem>
                  <SelectItem value="full-auto">full-auto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Model */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-model">Model</Label>
            <Input
              id="spawn-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-sonnet-4-5-20250514"
              className="h-11 sm:h-9"
            />
          </div>

          {/* Expose */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-expose">Expose to mesh</Label>
            <Input
              id="spawn-expose"
              value={expose}
              onChange={(e) => setExpose(e.target.value)}
              placeholder="chat, query"
              className="h-11 sm:h-9"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated capabilities to expose. Leave empty to keep
              private.
            </p>
          </div>

          {/* Meter Off checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="spawn-meter-off"
              checked={meterOff}
              onCheckedChange={(checked) => setMeterOff(checked === true)}
            />
            <Label htmlFor="spawn-meter-off" className="cursor-pointer">
              Disable metering
            </Label>
          </div>

          {serverError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <Button
            type="submit"
            disabled={!canSubmit}
            className="w-full sm:w-auto self-end"
          >
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Create Bot
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
