import { useMemo } from "react";
import type { BotInfo } from "./bot-card";

export const SAFE_CONFIG_KEYS: (keyof BotInfo)[] = [
  "name", "state", "port", "workspacePath", "homeDir", "startedAt", "stoppedAt",
  "exitCode", "tags", "node", "model", "sandboxMode", "permissionMode",
  "auth", "authType", "costToday",
];

export function BotConfigView({ bot }: { bot: BotInfo }) {
  const json = useMemo(() => {
    const safe: Partial<BotInfo> = {};
    for (const key of SAFE_CONFIG_KEYS) {
      if (key in bot) (safe as Record<string, unknown>)[key] = bot[key];
    }
    return JSON.stringify(safe, null, 2);
  }, [bot]);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <pre className="text-xs font-mono text-card-foreground whitespace-pre-wrap">
        {json}
      </pre>
    </div>
  );
}
