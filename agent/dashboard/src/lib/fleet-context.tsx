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

  const retryCountRef = useRef(0);
  const refreshBots = useCallback(() => {
    fleetFetch("/api/bots")
      .then((r) => {
        if (r.status === 404) {
          // Definitive "not fleet" — single bot mode
          if (isFleetRef.current === null) setIsFleet(false);
          return;
        }
        if (!r.ok) throw new Error("transient");
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        retryCountRef.current = 0;
        setBots(data as FleetBot[]);
        if (isFleetRef.current === null) setIsFleet(true);
      })
      .catch(() => {
        // Transient error — retry up to 3 times before giving up
        retryCountRef.current++;
        if (isFleetRef.current === null && retryCountRef.current >= 3) setIsFleet(false);
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
