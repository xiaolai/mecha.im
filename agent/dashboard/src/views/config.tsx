import { useState, useEffect } from "react";
import { botFetch } from "../lib/api";

export default function Config() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [costs, setCosts] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    Promise.all([
      botFetch("/api/config").then((r) => r.json()),
      botFetch("/api/status").then((r) => r.json()),
      botFetch("/api/costs").then((r) => r.json()),
    ]).then(([c, s, co]) => {
      setConfig(c);
      setStatus(s);
      setCosts(co);
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-3">Status</h2>
        {status && (
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 font-mono text-sm">
            <pre>{JSON.stringify(status, null, 2)}</pre>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Costs</h2>
        {costs && (
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(costs).map(([k, v]) => (
              <div key={k} className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 text-center">
                <div className="text-2xl font-bold">${typeof v === "number" ? v.toFixed(4) : v}</div>
                <div className="text-gray-500 text-sm mt-1">{k}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Configuration</h2>
        {config && (
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 font-mono text-sm">
            <pre>{JSON.stringify(config, null, 2)}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
