import { useState, useEffect } from "react";
import { useFleet } from "./lib/fleet-context";
import { setActiveBotName } from "./lib/api";
import Sessions from "./views/sessions";
import Schedule from "./views/schedule";
import Settings from "./views/settings";
import Webhooks from "./views/webhooks";
import Fleet from "./views/fleet";
import Network from "./views/network";
import Auth from "./views/auth";

// Bot-level tabs (shown when viewing a specific bot)
const botTabs = ["Sessions", "Schedule", "Webhooks", "Settings"] as const;
type BotTab = (typeof botTabs)[number];

// Fleet-level tabs (shown in fleet overview)
const fleetTabs = ["Fleet", "Network", "Auth"] as const;
type FleetTab = (typeof fleetTabs)[number];

type Tab = BotTab | FleetTab;

const icons: Record<string, string> = {
  Sessions: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  Schedule: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  Webhooks: "M13 10V3L4 14h7v7l9-11h-7z",
  Settings: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  Fleet: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  Network: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
  Auth: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z",
};

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  return (
    <button
      onClick={() => setDark(!dark)}
      className="p-2 rounded-md text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      )}
    </button>
  );
}

export default function App() {
  const { isFleet, selectedBot, selectBot, bots } = useFleet();
  const [tab, setTab] = useState<Tab>("Sessions");

  // In fleet mode, switch tabs based on bot selection
  useEffect(() => {
    if (!isFleet) return;
    if (selectedBot) {
      // Switched to a bot — show bot tabs
      if (fleetTabs.includes(tab as FleetTab)) setTab("Sessions");
    } else {
      // Back to fleet overview
      if (botTabs.includes(tab as BotTab)) setTab("Fleet");
    }
  }, [isFleet, selectedBot]);

  // Sync active bot name for API routing
  useEffect(() => {
    setActiveBotName(isFleet ? selectedBot : null);
  }, [isFleet, selectedBot]);

  // Loading state
  if (isFleet === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  const viewingBot = isFleet ? selectedBot : true; // In direct mode, always viewing "the" bot

  function handleBackToFleet() {
    selectBot(null);
    setTab("Fleet");
  }

  const selectedBotStatus = selectedBot ? bots.find((b) => b.name === selectedBot) : null;

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-14 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col items-center py-3 gap-1">
        {/* Logo / back button */}
        {isFleet && selectedBot ? (
          <button
            onClick={handleBackToFleet}
            className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-secondary-foreground hover:bg-secondary/80 transition-colors mb-4"
            title="Back to fleet"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm mb-4">
            M
          </div>
        )}

        {/* Nav tabs */}
        <nav className="flex flex-col gap-1 flex-1">
          {/* Fleet tabs (always visible in fleet mode) */}
          {isFleet && !selectedBot && fleetTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                tab === t
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent"
              }`}
              title={t}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icons[t]} />
              </svg>
            </button>
          ))}

          {/* Bot tabs (when viewing a specific bot) */}
          {viewingBot && botTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                tab === t
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent"
              }`}
              title={t}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icons[t]} />
              </svg>
            </button>
          ))}
        </nav>

        {/* Bottom: theme toggle */}
        <ThemeToggle />
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-background">
        {/* Bot context bar (fleet mode, viewing a bot) */}
        {isFleet && selectedBot && (
          <div className="shrink-0 px-4 py-2 border-b border-border bg-card flex items-center gap-3">
            <span
              className={`w-2 h-2 rounded-full ${
                selectedBotStatus?.status === "running" ? "bg-green-500" : "bg-muted-foreground"
              }`}
            />
            <span className="text-sm font-medium text-foreground">{selectedBot}</span>
            {selectedBotStatus && (
              <span className="text-xs text-muted-foreground">
                {selectedBotStatus.model} | {selectedBotStatus.status}
              </span>
            )}
          </div>
        )}

        {/* Tab content */}
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {/* Fleet views */}
          {tab === "Fleet" && <Fleet />}
          {tab === "Network" && <Network />}
          {tab === "Auth" && <Auth />}

          {/* Bot views */}
          {tab === "Sessions" && viewingBot && <Sessions />}
          {tab === "Schedule" && viewingBot && <Schedule />}
          {tab === "Webhooks" && viewingBot && <Webhooks />}
          {tab === "Settings" && viewingBot && <Settings />}
        </main>
      </div>
    </div>
  );
}
