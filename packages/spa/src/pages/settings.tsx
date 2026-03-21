import { PageShell } from "@/components/page-shell";
import { SettingsView } from "@/components/settings-view";

/** Settings page for viewing and editing agent configuration. */
export function SettingsPage() {
  return (
    <PageShell title="Settings">
      <SettingsView />
    </PageShell>
  );
}
