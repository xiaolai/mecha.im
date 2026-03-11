import { useState } from "react";
import Fleet from "./views/fleet";
import Network from "./views/network";
import Auth from "./views/auth";

const tabs = ["Fleet", "Network", "Auth"] as const;
type Tab = (typeof tabs)[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("Fleet");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-6">
        <h1 className="text-lg font-bold text-white">Mecha Fleet</h1>
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
        {tab === "Fleet" && <Fleet />}
        {tab === "Network" && <Network />}
        {tab === "Auth" && <Auth />}
      </main>
    </div>
  );
}
