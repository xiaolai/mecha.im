import { PageShell } from "@/components/page-shell";
import { NodesView } from "@/components/nodes-view";

/** Nodes page for viewing and managing mesh network nodes. */
export function NodesPage() {
  return (
    <PageShell title="Nodes">
      <NodesView />
    </PageShell>
  );
}
