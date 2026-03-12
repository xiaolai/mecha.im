import { useState, useCallback } from "react";
import SessionList from "./sessions/session-list";
import SessionDetail from "./sessions/session-detail";
import TerminalPane from "./sessions/terminal-pane";

interface SelectedSession {
  id: string;
  hasPty: boolean;
}

export default function Sessions() {
  const [selected, setSelected] = useState<SelectedSession | null>(null);
  const [newSession, setNewSession] = useState(false);

  const handleNewSessionId = useCallback((id: string) => {
    setSelected({ id, hasPty: true });
    setNewSession(false);
  }, []);

  return (
    <div className="flex h-full">
      {/* Left: session list */}
      <SessionList
        selectedId={selected?.id ?? null}
        onSelect={(id, hasPty) => {
          setSelected({ id, hasPty });
          setNewSession(false);
        }}
        onNewSession={() => {
          setSelected(null);
          setNewSession(true);
        }}
      />

      {/* Right: detail or new terminal */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {newSession && (
          <TerminalPane className="flex-1" onSessionId={handleNewSessionId} />
        )}
        {!newSession && selected && (
          <SessionDetail
            sessionId={selected.id}
            hasPty={selected.hasPty}
            className="flex-1 min-h-0"
          />
        )}
        {!newSession && !selected && (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select a session or start a new one
          </div>
        )}
      </div>
    </div>
  );
}
