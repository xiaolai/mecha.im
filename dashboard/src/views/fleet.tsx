import { useState, useEffect } from "react";

interface Bot {
  name: string;
  status: string;
  model: string;
  containerId: string;
  ports: string;
}

export default function Fleet() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawnName, setSpawnName] = useState("");
  const [spawnSystem, setSpawnSystem] = useState("");
  const [spawnModel, setSpawnModel] = useState("sonnet");

  function refresh() {
    fetch("/api/bots")
      .then((r) => r.json())
      .then(setBots)
      .catch(() => {});
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  async function spawn() {
    if (!spawnName || !spawnSystem) return;
    await fetch("/api/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: spawnName, system: spawnSystem, model: spawnModel }),
    });
    setShowSpawn(false);
    setSpawnName("");
    setSpawnSystem("");
    refresh();
  }

  async function stopBot(name: string) {
    await fetch(`/api/bots/${name}/stop`, { method: "POST" });
    refresh();
  }

  async function removeBot(name: string) {
    await fetch(`/api/bots/${name}`, { method: "DELETE" });
    refresh();
  }

  async function restartBot(name: string) {
    await fetch(`/api/bots/${name}/restart`, { method: "POST" });
    refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Bots ({bots.length})</h2>
        <button
          onClick={() => setShowSpawn(!showSpawn)}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium"
        >
          Spawn Bot
        </button>
      </div>

      {showSpawn && (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 mb-6 space-y-3">
          <input
            value={spawnName}
            onChange={(e) => setSpawnName(e.target.value)}
            placeholder="Bot name"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
          />
          <textarea
            value={spawnSystem}
            onChange={(e) => setSpawnSystem(e.target.value)}
            placeholder="System prompt"
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
          />
          <div className="flex gap-3">
            <select
              value={spawnModel}
              onChange={(e) => setSpawnModel(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            >
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
            <button
              onClick={spawn}
              disabled={!spawnName || !spawnSystem}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-700 px-4 py-2 rounded text-sm font-medium"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {bots.length === 0 && <p className="text-gray-500">No bots running</p>}
        {bots.map((bot) => (
          <div
            key={bot.name}
            className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  bot.status === "running" ? "bg-green-400" : "bg-gray-500"
                }`}
              />
              <div>
                <a
                  href={`/bot/${bot.name}/dashboard/`}
                  className="font-medium hover:text-blue-400"
                >
                  {bot.name}
                </a>
                <div className="text-sm text-gray-500">
                  {bot.model} | {bot.containerId} {bot.ports && `| ${bot.ports}`}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {bot.status === "running" ? (
                <button
                  onClick={() => stopBot(bot.name)}
                  className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => restartBot(bot.name)}
                  className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
                >
                  Start
                </button>
              )}
              <button
                onClick={() => removeBot(bot.name)}
                className="text-sm bg-red-900/50 hover:bg-red-800 text-red-300 px-3 py-1 rounded"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
