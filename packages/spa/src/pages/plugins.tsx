import { PageShell } from "@/components/page-shell";
import { PluginsView } from "@/components/plugins-view";

/** Plugins page for browsing and managing MCP plugins. */
export function PluginsPage() {
  return (
    <PageShell title="Plugins">
      <PluginsView />
    </PageShell>
  );
}
