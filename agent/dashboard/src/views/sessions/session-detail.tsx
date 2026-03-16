import { useState } from "react";
import { FileType, FileTerminal } from "lucide-react";
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
      <div className="flex items-center justify-end gap-1 px-4 py-2 bg-card">
        <button
          onClick={() => setShowTerminal(false)}
          className={`p-1.5 transition-colors ${
            !showTerminal ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          title="History"
        >
          <FileType className="w-4 h-4" />
        </button>
        <button
          onClick={() => hasPty && setShowTerminal(true)}
          className={`p-1.5 transition-colors ${
            showTerminal ? "text-foreground" : hasPty ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/40 cursor-not-allowed"
          }`}
          title={hasPty ? "Terminal" : "No terminal for this session"}
          disabled={!hasPty}
        >
          <FileTerminal className="w-4 h-4" />
        </button>
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
