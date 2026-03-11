import { useState, useEffect } from "react";

export default function Auth() {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [newProfile, setNewProfile] = useState("");
  const [newKey, setNewKey] = useState("");

  function refresh() {
    fetch("/api/auth")
      .then((r) => r.json())
      .then(setProfiles)
      .catch(() => {});
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addProfile() {
    if (!newProfile || !newKey) return;
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: newProfile, key: newKey }),
    });
    setNewProfile("");
    setNewKey("");
    refresh();
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-4">Auth Profiles</h2>
        <div className="space-y-2">
          {profiles.length === 0 && <p className="text-gray-500">No profiles configured</p>}
          {profiles.map((p) => (
            <div
              key={p}
              className="bg-gray-800/50 rounded-lg border border-gray-700 p-3 flex items-center gap-3"
            >
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="font-mono">{p}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">Add Profile</h2>
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 space-y-3">
          <input
            value={newProfile}
            onChange={(e) => setNewProfile(e.target.value)}
            placeholder="Profile name (e.g. anthropic-main)"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
          />
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="API key (sk-ant-... or tskey-...)"
            type="password"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
          />
          <button
            onClick={addProfile}
            disabled={!newProfile || !newKey}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-4 py-2 rounded text-sm font-medium"
          >
            Add Profile
          </button>
        </div>
      </section>
    </div>
  );
}
