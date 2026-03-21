import { useState, useRef, useEffect } from "react";
import { Loader2Icon, EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth-context";

// --- Token Input ---

function TokenInput({ id, value, onChange, placeholder, inputRef }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

// --- Add Profile Dialog ---

/** Dialog for creating a new auth profile with name, type, and token fields. */
export function AddProfileDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { authHeaders } = useAuth();
  const [name, setName] = useState("");
  const [type, setType] = useState<"oauth" | "api-key">("api-key");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setType("api-key");
      setToken("");
      setError(null);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/settings/auth-profiles", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), type, token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setError(body.error ?? "Failed to create profile");
        return;
      }
      onCreated();
      onOpenChange(false);
    } catch {
      setError("Connection error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <form onSubmit={handleSubmit}>
          <AlertDialogHeader>
            <AlertDialogTitle>Add Auth Profile</AlertDialogTitle>
            <AlertDialogDescription>
              Create a new authentication profile for bot sessions.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ap-name" className="text-sm font-medium text-card-foreground">Name</label>
              <input
                ref={nameRef}
                id="ap-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-profile"
                autoComplete="off"
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-card-foreground">Type</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setType("api-key")}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    type === "api-key"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-card-foreground",
                  )}
                >
                  API Key
                </button>
                <button
                  type="button"
                  onClick={() => setType("oauth")}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    type === "oauth"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-card-foreground",
                  )}
                >
                  OAuth
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ap-token" className="text-sm font-medium text-card-foreground">Token</label>
              <TokenInput
                id="ap-token"
                value={token}
                onChange={setToken}
                placeholder={type === "api-key" ? "sk-ant-..." : "eyJ..."}
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={busy || !name.trim() || !token}>
              {busy && <Loader2Icon className="size-4 animate-spin" />}
              Add Profile
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Renew Token Dialog ---

/** Dialog for replacing an existing auth profile's token. */
export function RenewTokenDialog({ open, onOpenChange, profileName, onRenewed }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileName: string;
  onRenewed: () => void;
}) {
  const { authHeaders } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tokenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setToken("");
      setError(null);
      setTimeout(() => tokenRef.current?.focus(), 50);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/settings/auth-profiles/${encodeURIComponent(profileName)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setError(body.error ?? "Failed to renew token");
        return;
      }
      onRenewed();
      onOpenChange(false);
    } catch {
      setError("Connection error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <form onSubmit={handleSubmit}>
          <AlertDialogHeader>
            <AlertDialogTitle>Renew Token</AlertDialogTitle>
            <AlertDialogDescription>
              Replace the token for <span className="font-mono font-medium text-foreground">{profileName}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rt-token" className="text-sm font-medium text-card-foreground">New Token</label>
              <TokenInput
                id="rt-token"
                inputRef={tokenRef}
                value={token}
                onChange={setToken}
                placeholder="Paste new token..."
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={busy || !token}>
              {busy && <Loader2Icon className="size-4 animate-spin" />}
              Renew
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
