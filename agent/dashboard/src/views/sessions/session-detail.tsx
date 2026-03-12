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
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900/60">
        <button
          onClick={() => setShowTerminal(false)}
          className={`px-3 py-1 rounded text-xs font-medium ${
            !showTerminal ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          Conversation
        </button>
        {hasPty && (
          <button
            onClick={() => setShowTerminal(true)}
            className={`px-3 py-1 rounded text-xs font-medium ${
              showTerminal ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            Terminal
          </button>
        )}
        {!hasPty && (
          <button
            onClick={() => setShowTerminal(true)}
            className={`px-3 py-1 rounded text-xs font-medium ${
              showTerminal ? "bg-green-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
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
