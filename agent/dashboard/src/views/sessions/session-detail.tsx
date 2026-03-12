import { useState } from "react";
import ConversationViewer from "./conversation-viewer";
import TerminalPane from "./terminal-pane";

interface Props {
  sessionId: string;
  hasPty: boolean;
  className?: string;
}

export default function SessionDetail({ sessionId, hasPty, className }: Props) {
  const [showTerminal, setShowTerminal] = useState(false);

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      {/* Action bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card">
        <button
          onClick={() => setShowTerminal(false)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            !showTerminal
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          Conversation
        </button>
        {hasPty && (
          <button
            onClick={() => setShowTerminal(true)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              showTerminal
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            Terminal
          </button>
        )}
        {!hasPty && (
          <button
            onClick={() => setShowTerminal(true)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              showTerminal
                ? "bg-success text-success-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            Continue Session
          </button>
        )}
      </div>

      {/* Content */}
      {!showTerminal ? (
        <ConversationViewer sessionId={sessionId} className="flex-1 min-h-0" />
      ) : (
        <TerminalPane sessionId={sessionId} className="flex-1 min-h-0" />
      )}
    </div>
  );
}
