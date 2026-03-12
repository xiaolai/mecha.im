import { useState } from "react";
import Sessions from "./views/sessions";
import Schedule from "./views/schedule";
import Settings from "./views/settings";

const tabs = ["Sessions", "Schedule", "Settings"] as const;
type Tab = (typeof tabs)[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("Sessions");

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-6">
        <h1 className="text-lg font-bold text-white">Mecha Bot</h1>
        <nav className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-sm ${
                tab === t
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>
      <main className="flex-1 min-h-0 overflow-hidden">
        {tab === "Sessions" && <Sessions />}
        {tab === "Schedule" && <Schedule />}
        {tab === "Settings" && <Settings />}
      </main>
    </div>
  );
}
