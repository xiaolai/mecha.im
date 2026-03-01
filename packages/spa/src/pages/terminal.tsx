import { useParams, useSearchParams } from "react-router-dom";
import { useState, useCallback } from "react";
import { Terminal } from "@/components/terminal";
import { SessionSelector } from "@/components/session-selector";

export function TerminalPage() {
  const { name: casaName } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const node = searchParams.get("node") ?? undefined;
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [exitCode, setExitCode] = useState<number | null>(null);

  const handleSessionCreated = useCallback((id: string) => {
    setSessionId(id);
  }, []);

  const handleExit = useCallback((code: number) => {
    setExitCode(code);
  }, []);

  const handleNewSession = useCallback(() => {
    setSessionId(undefined);
    setExitCode(null);
  }, []);

  if (!casaName) return null;

  return (
    <div className="flex flex-col h-full gap-3 p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <SessionSelector
          casaName={casaName}
          node={node}
          currentSessionId={sessionId}
          onSelect={(id) => {
            setSessionId(id);
            setExitCode(null);
          }}
        />
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
