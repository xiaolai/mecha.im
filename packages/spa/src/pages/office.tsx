import { useState, useCallback } from "react";
import { OfficeCanvas } from "@/components/office/office-canvas";
import { InspectPanel } from "@/components/office/inspect-panel";

export function OfficePage() {
  const [selectedBot, setSelectedBot] = useState<string | null>(null);

  const handleBotClick = useCallback((name: string) => {
    setSelectedBot(prev => prev === name ? null : name);
  }, []);

  return (
    <div className="flex h-full gap-4 p-5">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="text-sm font-medium text-muted-foreground">
          Pixel Office
        </div>
        <OfficeCanvas onBotClick={handleBotClick} />
        <p className="text-xs text-muted-foreground">
          Click a bot to inspect. Bots move between rooms based on activity.
        </p>
      </div>
      {selectedBot && (
        <InspectPanel
          botName={selectedBot}
          onClose={() => setSelectedBot(null)}
        />
      )}
    </div>
  );
}
