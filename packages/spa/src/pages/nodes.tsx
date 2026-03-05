import { PageShell } from "@/components/page-shell";
import { NodesView } from "@/components/nodes-view";

export function NodesPage() {
  return (
    <PageShell title="Nodes">
      <NodesView />
    </PageShell>
  );
}
