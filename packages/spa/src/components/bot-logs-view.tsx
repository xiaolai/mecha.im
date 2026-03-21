import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";

interface Props { name: string }

/** Displays stdout/stderr log output for a bot with stream toggle. */
export function BotLogsView({ name }: Props) {
  const [stream, setStream] = useState<"stdout" | "stderr">("stdout");
  const { data, loading, error } = useFetch<{ lines: string[] }>(
    `/bots/${encodeURIComponent(name)}/logs?stream=${stream}&lines=500`,
    { interval: 5000, deps: [stream] },
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {(["stdout", "stderr"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStream(s)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              stream === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      <div className="max-h-[600px] overflow-y-auto rounded-lg bg-muted/30 p-4">
        {loading && !data ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : data?.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No logs yet.</p>
        ) : (
          <pre className="font-mono text-xs text-foreground whitespace-pre-wrap break-all">
            {data?.lines.join("\n")}
          </pre>
        )}
      </div>
    </div>
  );
}
