import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";

export interface FleetBot {
  name: string;
  status: string;
  model: string;
  containerId: string;
  ports: string;
}

interface FleetContextValue {
  /** null = detection in progress, false = bot-direct mode, true = fleet mode */
  isFleet: boolean | null;
  bots: FleetBot[];
  selectedBot: string | null;
  selectBot: (name: string | null) => void;
  refreshBots: () => void;
}

const FleetContext = createContext<FleetContextValue>({
  isFleet: null,
  bots: [],
  selectedBot: null,
  selectBot: () => {},
  refreshBots: () => {},
});

export function useFleet() {
  return useContext(FleetContext);
}

/** Fetch wrapper for fleet-level APIs (always hits host, no bot prefix) */
export function fleetFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { ...init, credentials: "same-origin" });
}

export function FleetProvider({ children }: { children: ReactNode }) {
  const [isFleet, setIsFleet] = useState<boolean | null>(null);
  const [bots, setBots] = useState<FleetBot[]>([]);
  const [selectedBot, setSelectedBot] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const isFleetRef = useRef(isFleet);
  isFleetRef.current = isFleet;

  const refreshBots = useCallback(() => {
    fleetFetch("/api/bots")
      .then((r) => {
        if (!r.ok) throw new Error("not fleet");
        return r.json();
      })
      .then((data) => {
        setBots(data as FleetBot[]);
        if (isFleetRef.current === null) setIsFleet(true);
      })
      .catch(() => {
        if (isFleetRef.current === null) setIsFleet(false);
      });
  }, []);

  useEffect(() => {
    refreshBots();
  }, [refreshBots]);

  // Poll bots list in fleet mode
  useEffect(() => {
    if (isFleet !== true) return;
    pollRef.current = setInterval(refreshBots, 5000);
    return () => clearInterval(pollRef.current);
  }, [isFleet, refreshBots]);

  const selectBot = useCallback((name: string | null) => {
    setSelectedBot(name);
  }, []);

  return (
    <FleetContext.Provider value={{ isFleet, bots, selectedBot, selectBot, refreshBots }}>
      {children}
    </FleetContext.Provider>
  );
}
