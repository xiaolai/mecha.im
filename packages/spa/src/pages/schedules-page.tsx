import { PageShell } from "@/components/page-shell";
import { ScheduleOverview } from "@/components/schedule-overview";

export function SchedulesPage() {
  return (
    <PageShell title="Schedules">
      <ScheduleOverview />
    </PageShell>
  );
}
