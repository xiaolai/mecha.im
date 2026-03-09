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
import { Loader2Icon } from "lucide-react";
import { useAuth } from "@/auth-context";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

/** Sheet form for registering a new remote node to the mesh. */
export function NodeAddForm({ open, onOpenChange, onAdded }: Props) {
  const { authHeaders } = useAuth();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("7660");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const nameError =
    touched.name && !/^[a-z0-9][a-z0-9-]*$/.test(name)
      ? "Lowercase letters, numbers, hyphens only."
      : null;
  const portNum = Number(port);
  const portError =
    touched.port && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
      ? "Must be 1-65535."
      : null;
  const canSubmit =
    name.length > 0 &&
    host.length > 0 &&
    port.length > 0 &&
    apiKey.length > 0 &&
    !nameError &&
    !portError &&
    !submitting;

  function resetForm() {
    setName("");
    setHost("");
    setPort("7660");
    setApiKey("");
    setTouched({});
    setServerError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Validate regardless of touch state on submit
    setTouched({ name: true, port: true });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return;
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await fetch("/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ name, host, port: portNum, apiKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setServerError((data as { error?: string }).error ?? `Error ${res.status}`);
        return;
      }
      onAdded();
      onOpenChange(false);
      resetForm();
    } catch {
      setServerError("Connection error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add Node</SheetTitle>
          <SheetDescription>Register a remote peer node to the mesh.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="node-name">Name</Label>
            <Input
              id="node-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              placeholder="linode02"
              className="h-11 sm:h-9 font-mono"
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="node-host">Host</Label>
            <Input
              id="node-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
              className="h-11 sm:h-9 font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="node-port">Port</Label>
            <Input
              id="node-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, port: true }))}
              placeholder="7660"
              className="h-11 sm:h-9 font-mono"
              min={1}
              max={65535}
            />
            {portError && <p className="text-xs text-destructive">{portError}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="node-apikey">API Key</Label>
            <Input
              id="node-apikey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Bearer token for mesh auth"
              className="h-11 sm:h-9"
            />
          </div>

          {serverError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto self-end">
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Add Node
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
