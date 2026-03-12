import { useState, useEffect } from "react";
import { botFetch } from "../lib/api";

interface Task {
  id: string;
  created: string;
  status: string;
  summary?: string;
  cost_usd: number;
}

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    botFetch("/api/tasks")
      .then((r) => r.json())
      .then(setTasks)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold mb-4">Tasks</h2>
      {tasks.length === 0 && <p className="text-gray-500">No tasks yet</p>}
      {tasks.map((task) => (
        <div
          key={task.id}
          className="bg-gray-800/50 rounded-lg border border-gray-700"
        >
          <button
            onClick={() => setExpanded(expanded === task.id ? null : task.id)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-800"
          >
            <div className="flex items-center gap-3">
              <span
                className={`w-2 h-2 rounded-full ${
                  task.status === "active" ? "bg-green-400" : task.status === "error" ? "bg-red-400" : "bg-gray-500"
                }`}
              />
              <span className="font-mono text-sm">{task.id.slice(0, 8)}</span>
              <span className="text-gray-400 text-sm">{task.status}</span>
            </div>
            <span className="text-gray-500 text-sm">
              ${task.cost_usd.toFixed(4)}
            </span>
          </button>
          {expanded === task.id && (
            <div className="px-4 pb-3 text-sm space-y-1 border-t border-gray-700 pt-2">
              <p><span className="text-gray-500">Created:</span> {new Date(task.created).toLocaleString()}</p>
              {task.summary && <p><span className="text-gray-500">Summary:</span> {task.summary}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
