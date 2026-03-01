import { PageShell } from "@/components/page-shell";
import { AclView } from "@/components/acl-view";

export function AclPage() {
  return (
    <PageShell title="ACL Rules">
      <AclView />
    </PageShell>
  );
}
