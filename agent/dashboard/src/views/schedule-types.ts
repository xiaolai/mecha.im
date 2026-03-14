export interface ScheduleEntry {
  id: string;
  cron: string;
  prompt: string;
  status: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  runCount: number;
  runsToday: number;
  consecutiveErrors: number;
}
