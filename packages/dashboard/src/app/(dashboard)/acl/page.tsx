import { AclView } from "@/components/acl-view";
import { PageShell } from "@/components/page-shell";

export default function AclPage() {
  return (
    <PageShell title="ACL Rules">
      <AclView />
    </PageShell>
  );
}
