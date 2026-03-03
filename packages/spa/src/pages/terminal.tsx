import { useParams, useSearchParams, Link } from "react-router-dom";
import { useState, useCallback, useMemo } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { Terminal } from "@/components/terminal";
import { SessionSelector } from "@/components/session-selector";
import { useFetch } from "@/lib/use-fetch";

export function TerminalPage() {
  const { name: casaName } = useParams<{ name: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const node = searchParams.get("node") ?? undefined;
  // Derive session from URL as source of truth — keeps state in sync with
  // back/forward navigation and manual URL edits.
  const sessionId = searchParams.get("session") ?? undefined;
  const nodeQuery = node ? `?node=${encodeURIComponent(node)}` : "";
  const { data: casaStatus } = useFetch<{ state?: string }>(
    casaName ? `/casas/${encodeURIComponent(casaName)}/status${nodeQuery}` : null,
    { deps: [casaName, node], interval: 10_000 },
  );
  const [exitCode, setExitCode] = useState<number | null>(null);
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
    setSearchParams((prev) => {
      prev.delete("session");
      return prev;
    });
    setTerminalGen((g) => g + 1);
  }, [setSearchParams]);

  const handleSelectSession = useCallback((id: string | undefined) => {
    setExitCode(null);
    setSearchParams((prev) => {
      if (id) {
        prev.set("session", id);
      } else {
        prev.delete("session");
      }
      return prev;
    });
    setTerminalGen((g) => g + 1);
  }, [setSearchParams]);

  // Stable key for Terminal — changes only on explicit user actions, not on
  // server-assigned session IDs (which would cause infinite remount loop).
  const terminalKey = useMemo(() => `${casaName}-${terminalGen}`, [casaName, terminalGen]);

  if (!casaName) return null;

  return (
    <div className="flex flex-col h-full gap-3 p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            to={`/casa/${encodeURIComponent(casaName)}${nodeQuery}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            <span className="hidden sm:inline">{casaName}</span>
          </Link>
          <SessionSelector
            casaName={casaName}
            node={node}
            currentSessionId={sessionId}
            casaState={casaStatus?.state}
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
      <div className="flex-1 min-h-0 rounded-lg border border-border overflow-hidden">
        <Terminal
          key={terminalKey}
          casaName={casaName}
          sessionId={sessionId}
          node={node}
          onSessionCreated={handleSessionCreated}
          onExit={handleExit}
        />
      </div>
    </div>
  );
}
