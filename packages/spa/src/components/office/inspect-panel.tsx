import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { XIcon, SendIcon, ExternalLinkIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface InspectPanelProps {
  botName: string;
  onClose: () => void;
}

interface BotInfo {
  name: string;
  state: string;
  port: number;
  uptime?: string;
}

export function InspectPanel({ botName, onClose }: InspectPanelProps) {
  const navigate = useNavigate();
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/bots/${botName}`)
      .then((r) => r.json())
      .then((data) => setBotInfo(data as BotInfo))
      .catch(() => {});
  }, [botName]);

  const sendMessage = useCallback(async () => {
    if (!message.trim()) return;
    setSending(true);
    setResponse(null);
    try {
      const res = await fetch(`/bots/${botName}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        setResponse(`Error: ${err.error ?? res.statusText}`);
        return;
      }
      const data = (await res.json()) as { response?: string };
      setResponse(data.response ?? "No response");
      setMessage("");
    } catch {
      setResponse("Failed to send message");
    } finally {
      setSending(false);
    }
  }, [botName, message]);

  return (
    <div className="w-full sm:w-80 rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-card-foreground font-mono">
          {botName}
        </h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <div>
          State:{" "}
          <span className="text-foreground font-medium">
            {botInfo?.state ?? "..."}
          </span>
        </div>
        <div>
          Port:{" "}
          <span className="font-mono text-foreground">
            {botInfo?.port ?? "-"}
          </span>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <div className="text-xs font-medium text-muted-foreground mb-2">
          Send Message
        </div>
        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Ask something..."
            className="h-8 text-xs"
            disabled={sending}
          />
          <Button
            variant="outline"
            size="icon-xs"
            onClick={sendMessage}
            disabled={sending || !message.trim()}
          >
            <SendIcon className="size-3" />
          </Button>
        </div>
        {response && (
          <div className="mt-2 rounded-md bg-muted p-2 text-xs text-foreground max-h-32 overflow-y-auto">
            {response}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="xs"
          onClick={() => navigate(`/bot/${botName}`)}
          className="flex-1"
        >
          <ExternalLinkIcon className="size-3 mr-1" />
          Details
        </Button>
        <Button
          variant="outline"
          size="xs"
          className="flex-1 text-destructive border-destructive/30"
          onClick={async () => {
            await fetch(`/bots/${botName}/stop`, { method: "POST" });
          }}
        >
          <SquareIcon className="size-3 mr-1" />
          Stop
        </Button>
      </div>
    </div>
  );
}
