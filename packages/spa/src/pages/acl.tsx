import { PageShell } from "@/components/page-shell";
import { AclView } from "@/components/acl-view";

/** ACL rules page for managing bot access control lists. */
export function AclPage() {
  return (
    <PageShell title="ACL Rules">
      <AclView />
    </PageShell>
  );
}
