import { useState } from "react";
import { CheckCircle2Icon, AlertTriangleIcon, XCircleIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth-context";

interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

interface DoctorResult {
  checks: DoctorCheck[];
  healthy: boolean;
}

const statusIcon = {
  ok: <CheckCircle2Icon className="size-4 text-success" />,
  warn: <AlertTriangleIcon className="size-4 text-warning" />,
  error: <XCircleIcon className="size-4 text-destructive" />,
};

export function DoctorView() {
  const { authHeaders } = useAuth();
  const [result, setResult] = useState<DoctorResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDiagnostics() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/doctor", {
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setError(data.error ?? "Diagnostics request failed");
        return;
      }
      setResult(await res.json());
    } catch {
      setError("Connection error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={runDiagnostics} disabled={running}>
          {running && <Loader2Icon className="size-4 animate-spin" />}
          Run Diagnostics
        </Button>
        {result && (
          <span className={`text-sm font-medium ${result.healthy ? "text-success" : "text-destructive"}`}>
            {result.healthy ? "All checks passed" : "Issues detected"}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {result && (
        <div className="rounded-lg border border-border">
          <div className="flex flex-col divide-y divide-border">
            {result.checks.map((check) => (
              <div key={check.name} className="flex items-center gap-3 px-4 py-3">
                {statusIcon[check.status]}
                <span className="font-mono text-sm text-foreground min-w-24">{check.name}</span>
                <span className="text-sm text-muted-foreground">{check.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
