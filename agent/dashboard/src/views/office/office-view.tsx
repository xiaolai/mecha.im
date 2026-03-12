import { useRef, useEffect, useState, useCallback } from "react";
import { createBridge, type OfficeBridge, type ClickableItem, type ActivityState } from "./office-bridge";
import { startOfficeStatus } from "./office-status";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./tilemap-data";
import { botFetch } from "../../lib/api";

const STATUS_COLORS: Record<ActivityState, string> = {
  idle: "bg-green-500",
  thinking: "bg-yellow-500",
  calling: "bg-blue-500",
  scheduled: "bg-purple-500",
  webhook: "bg-orange-500",
  error: "bg-red-500",
};

export default function OfficeView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<OfficeBridge>(createBridge());
  const gameRef = useRef<Phaser.Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<ClickableItem | null>(null);
  const [bridgeState, setBridgeState] = useState(bridgeRef.current.state);

  // Sync bridge state to React for status bar (poll every 500ms)
  useEffect(() => {
    const timer = setInterval(() => {
      setBridgeState({ ...bridgeRef.current.state });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // Set up furniture click handler
  useEffect(() => {
    bridgeRef.current.onFurnitureClick = (item: ClickableItem) => {
      setOverlay(item);
    };
    return () => {
      bridgeRef.current.onFurnitureClick = null;
    };
  }, []);

  // Start SSE + polling
  useEffect(() => {
    const cleanup = startOfficeStatus(bridgeRef.current);
    return cleanup;
  }, []);

  // Load Phaser and create game
  useEffect(() => {
    let destroyed = false;

    async function init() {
      try {
        const Phaser = await import("phaser");
        const { OfficeScene } = await import("./office-scene");

        if (destroyed || !containerRef.current) return;

        const game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: containerRef.current,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          pixelArt: true,
          antialias: false,
          roundPixels: true,
          scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
          },
          backgroundColor: "#1a1a2e",
          scene: [],
        });

        game.scene.add("OfficeScene", OfficeScene, true, { bridge: bridgeRef.current });
        gameRef.current = game;
        setLoading(false);
      } catch (err) {
        console.error("[OfficeView] Failed to load Phaser:", err);
        setError("Failed to load Pixel Office.");
      }
    }

    if (!gameRef.current) {
      init();
    }

    return () => {
      destroyed = true;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    gameRef.current = null;
    window.location.reload();
  }, []);

  const closeOverlay = useCallback(() => setOverlay(null), []);

  // Close overlay on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOverlay]);

  const formatStatus = () => {
    const s = bridgeState;
    const parts: string[] = [s.activity];

    if (s.currentTool && s.activity !== "idle") {
      const ctx = s.currentToolContext ? ` ${s.currentToolContext}` : "";
      parts.push(`${s.currentTool}${ctx}`);
    }

    if (s.taskStartedAt && s.activity !== "idle") {
      const elapsed = Math.floor((Date.now() - new Date(s.taskStartedAt).getTime()) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      parts.push(`${mins}m ${secs.toString().padStart(2, "0")}s`);
    }

    if (s.activity === "idle" && s.idleSinceSec > 0) {
      if (s.idleSinceSec < 60) {
        parts.push(`last active ${s.idleSinceSec}s ago`);
      } else {
        parts.push(`last active ${Math.floor(s.idleSinceSec / 60)}m ago`);
      }
    }

    parts.push(`$${s.costToday.toFixed(2)} today`);

    return parts.join(" · ");
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-foreground mb-2">{error}</p>
          <button onClick={handleRetry} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-background">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-muted-foreground">Loading Pixel Office...</div>
          </div>
        )}

        <div ref={containerRef} className="relative" />

        {overlay && overlay !== "character" && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-20" onClick={closeOverlay}>
            <div className="bg-background border border-border rounded-lg shadow-lg max-w-2xl w-full max-h-[80%] overflow-auto p-4 m-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-medium text-foreground capitalize">{overlay}</h3>
                <button onClick={closeOverlay} className="text-muted-foreground hover:text-foreground text-lg">&times;</button>
              </div>
              <OverlayContent item={overlay} sessionId={bridgeState.currentSessionId} />
            </div>
          </div>
        )}

        {overlay === "character" && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-20" onClick={closeOverlay}>
            <div className="bg-background border border-border rounded-lg shadow-lg max-w-sm w-full p-4 m-4" onClick={(e) => e.stopPropagation()}>
              <CharacterEditorLazy bridge={bridgeRef.current} onClose={closeOverlay} />
            </div>
          </div>
        )}
      </div>

      <div className="h-8 shrink-0 bg-sidebar border-t border-sidebar-border flex items-center px-3 gap-2 text-xs text-sidebar-foreground">
        <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[bridgeState.activity]}`} />
        <span className="truncate">{formatStatus()}</span>
      </div>
    </div>
  );
}

function OverlayContent({ item, sessionId }: { item: ClickableItem; sessionId: string | null }) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sourceMap: Record<string, string> = {
      computer: sessionId ? `/api/sessions/${sessionId}` : "",
      phone: "/api/logs?source=interbot&limit=50",
      printer: "/api/schedule",
      server: "/api/logs?source=error&limit=50",
      door: "/api/logs?source=webhook&limit=50",
    };

    const url = sourceMap[item];
    if (!url) {
      setData([]);
      setLoading(false);
      return;
    }

    botFetch(url).then((r) => r.json()).then((d) => {
      setData(d);
      setLoading(false);
    }).catch(() => {
      setData([]);
      setLoading(false);
    });
  }, [item, sessionId]);

  if (loading) return <div className="text-muted-foreground text-sm">Loading...</div>;

  return (
    <pre className="text-xs text-foreground overflow-auto max-h-96 font-mono bg-muted/30 rounded p-2">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function CharacterEditorLazy({ bridge, onClose }: { bridge: OfficeBridge; onClose: () => void }) {
  const [Editor, setEditor] = useState<React.ComponentType<{ bridge: OfficeBridge; onClose: () => void }> | null>(null);

  useEffect(() => {
    import("./character-editor").then((mod) => {
      setEditor(() => mod.default);
    });
  }, []);

  if (!Editor) return <div className="text-muted-foreground text-sm p-4">Loading editor...</div>;
  return <Editor bridge={bridge} onClose={onClose} />;
}
