import { PageShell } from "@/components/page-shell";
import { ScheduleOverview } from "@/components/schedule-overview";

/** Schedules page for viewing and managing bot cron schedules. */
export function SchedulesPage() {
  return (
    <PageShell title="Schedules">
      <ScheduleOverview />
    </PageShell>
  );
}
