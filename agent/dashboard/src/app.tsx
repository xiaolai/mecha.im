import { useState, useEffect } from "react";
import Sessions from "./views/sessions";
import Schedule from "./views/schedule";
import Settings from "./views/settings";

const tabs = ["Sessions", "Schedule", "Settings"] as const;
type Tab = (typeof tabs)[number];

const icons: Record<Tab, string> = {
  Sessions: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  Schedule: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  Settings: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
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
  const [tab, setTab] = useState<Tab>("Sessions");

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-14 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col items-center py-3 gap-1">
        {/* Logo */}
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm mb-4">
          M
        </div>

        {/* Nav tabs */}
        <nav className="flex flex-col gap-1 flex-1">
          {tabs.map((t) => (
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
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-background">
        {tab === "Sessions" && <Sessions />}
        {tab === "Schedule" && <Schedule />}
        {tab === "Settings" && <Settings />}
      </main>
    </div>
  );
}
