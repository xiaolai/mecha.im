import { AuditView } from "@/components/audit-view";
import { PageShell } from "@/components/page-shell";

export default function AuditPage() {
  return (
    <PageShell title="Audit Log">
      <AuditView />
    </PageShell>
  );
}
