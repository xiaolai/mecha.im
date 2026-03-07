import { useParams, useSearchParams, Link } from "react-router-dom";
import { useState, useCallback, useMemo } from "react";
import { ArrowLeftIcon, PlayIcon, AlertTriangleIcon } from "lucide-react";
import { Terminal } from "@/components/terminal";
import { SessionSelector } from "@/components/session-selector";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

export function TerminalPage() {
  const { name: botName } = useParams<{ name: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const node = searchParams.get("node") ?? undefined;
  // Derive session from URL as source of truth — keeps state in sync with
  // back/forward navigation and manual URL edits.
  const sessionId = searchParams.get("session") ?? undefined;
  const nodeQuery = node ? `?node=${encodeURIComponent(node)}` : "";
  const { data: botStatus } = useFetch<{ state?: string }>(
    botName ? `/bots/${encodeURIComponent(botName)}/status${nodeQuery}` : null,
    { deps: [botName, node], interval: 10_000 },
  );
  const { authHeaders } = useAuth();
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  // Monotonic counter used as Terminal key — only incremented on explicit user
  // actions (session select, new session). Server-assigned session IDs from
  // onSessionCreated do NOT trigger remount (avoids infinite loop).
  const [terminalGen, setTerminalGen] = useState(0);

  const handleSessionCreated = useCallback((id: string) => {
    // Update URL to reflect server-assigned session without triggering remount.
    // Using `replace` so back button doesn't create a "new session" → "assigned session" pair.
    setSearchParams((prev) => {
      prev.set("session", id);
      return prev;
    }, { replace: true });
  }, [setSearchParams]);

  const handleExit = useCallback((code: number) => {
    setExitCode(code);
  }, []);

  const handleNewSession = useCallback(() => {
    setExitCode(null);
    // Use a new-* ID so the server spawns a fresh PTY instead of reattaching
    // to an existing session via findByBot() fallback.
    const newId = `new-${crypto.randomUUID().slice(0, 8)}`;
    setSearchParams((prev) => {
      prev.set("session", newId);
      return prev;
    });
    setTerminalGen((g) => g + 1);
  }, [setSearchParams]);

  const handleSelectSession = useCallback((id: string | undefined) => {
    setExitCode(null);
    // When id is undefined (user selected "New Session" from dropdown),
    // generate a new-* ID so the server spawns fresh PTY.
    const sessionValue = id ?? `new-${crypto.randomUUID().slice(0, 8)}`;
    setSearchParams((prev) => {
      prev.set("session", sessionValue);
      return prev;
    });
    setTerminalGen((g) => g + 1);
  }, [setSearchParams]);

  const handleStartBot = useCallback(async () => {
    if (!botName) return;
    setStarting(true);
    try {
      const res = await fetch(`/bots/${encodeURIComponent(botName)}/start`, {
        method: "POST", headers: authHeaders, credentials: "include",
      });
      if (!res.ok) return;
      // After starting, trigger a new session
      handleNewSession();
    } finally {
      setStarting(false);
    }
  }, [botName, authHeaders, handleNewSession]);

  // Stable key for Terminal — changes only on explicit user actions, not on
  // server-assigned session IDs (which would cause infinite remount loop).
  const terminalKey = useMemo(() => `${botName}-${terminalGen}`, [botName, terminalGen]);
  const isStopped = botStatus?.state === "stopped" || botStatus?.state === "error";
  const isRemote = !!node && node !== "local";

  if (!botName) return null;

  return (
    <div className="flex flex-col h-full gap-3 p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            to={`/bot/${encodeURIComponent(botName)}${nodeQuery}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            <span className="hidden sm:inline">{botName}</span>
          </Link>
          <SessionSelector
            botName={botName}
            node={node}
            currentSessionId={sessionId}
            botState={botStatus?.state}
            onSelect={handleSelectSession}
          />
        </div>
        {exitCode !== null && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Exited with code {exitCode}
            </span>
            <button
              onClick={handleNewSession}
              className="h-8 px-3 rounded-md border border-input bg-background text-sm hover:bg-accent"
            >
              New Session
            </button>
          </div>
        )}
      </div>
      {isRemote && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning-foreground">
          <AlertTriangleIcon className="size-4 shrink-0 text-warning" />
          Remote terminals are not yet supported. Use SSH to access the remote node directly.
        </div>
      )}
      {isStopped && !isRemote && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
          <span className="text-sm text-muted-foreground">Bot is stopped.</span>
          <button
            onClick={handleStartBot}
            disabled={starting}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-success/50 bg-success/10 text-sm font-medium text-success hover:bg-success/20 disabled:opacity-50"
          >
            <PlayIcon className="size-3.5" />
            {starting ? "Starting…" : "Start Bot"}
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 rounded-lg border border-border overflow-hidden">
        {!isRemote && !isStopped && (
          <Terminal
            key={terminalKey}
            botName={botName}
            sessionId={sessionId}
            node={node}
            onSessionCreated={handleSessionCreated}
            onExit={handleExit}
          />
        )}
      </div>
    </div>
  );
}
