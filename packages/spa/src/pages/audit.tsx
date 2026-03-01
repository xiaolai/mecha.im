import { PageShell } from "@/components/page-shell";
import { AuditView } from "@/components/audit-view";

export function AuditPage() {
  return (
    <PageShell title="Audit Log">
      <AuditView />
    </PageShell>
  );
}
