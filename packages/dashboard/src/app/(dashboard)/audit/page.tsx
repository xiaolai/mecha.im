import { AuditView } from "@/components/audit-view";

export default function AuditPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">Audit Log</h1>
      <AuditView />
    </div>
  );
}
