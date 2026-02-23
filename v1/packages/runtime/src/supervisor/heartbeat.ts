import type Database from "better-sqlite3";
import type { MechaId } from "@mecha/core";

export function startHeartbeat(
  db: Database.Database,
  mechaId: MechaId,
  intervalMs: number,
): () => void {
  const stmt = db.prepare(
    "INSERT INTO heartbeats (mecha_id, status, active_tasks) VALUES (?, ?, ?)",
  );

  const write = () => {
    try { stmt.run(mechaId, "running", 0); }
    /* v8 ignore start */
    catch (err) {
      console.error("Heartbeat write failed:", err instanceof Error ? err.message : err);
    }
    /* v8 ignore stop */
  };

  write();
  const timer = setInterval(write, intervalMs);
  return () => clearInterval(timer);
}
