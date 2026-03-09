import { PageShell } from "@/components/page-shell";
import { DoctorView } from "@/components/doctor-view";

/** Doctor page for running system health checks and diagnostics. */
export function DoctorPage() {
  return (
    <PageShell title="Doctor">
      <DoctorView />
    </PageShell>
  );
}
