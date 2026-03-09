import { PageShell } from "@/components/page-shell";
import { ToolsView } from "@/components/tools-view";

/** Tools page for viewing and managing available bot tools. */
export function ToolsPage() {
  return (
    <PageShell title="Tools">
      <ToolsView />
    </PageShell>
  );
}
