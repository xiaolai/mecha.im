import { useState } from "react";
import Chat from "./views/chat";
import Tasks from "./views/tasks";
import TerminalView from "./views/terminal";
import Schedule from "./views/schedule";
import Logs from "./views/logs";
import Config from "./views/config";

const tabs = ["Chat", "Tasks", "Terminal", "Schedule", "Logs", "Config"] as const;
type Tab = (typeof tabs)[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("Chat");

  return (
    <div className="min-h-screen flex flex-col">
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
      <main className="flex-1 p-6">
        {tab === "Chat" && <Chat />}
        {tab === "Tasks" && <Tasks />}
        {tab === "Terminal" && <TerminalView />}
        {tab === "Schedule" && <Schedule />}
        {tab === "Logs" && <Logs />}
        {tab === "Config" && <Config />}
      </main>
    </div>
  );
}
