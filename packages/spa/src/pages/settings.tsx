import { PageShell } from "@/components/page-shell";
import { SettingsView } from "@/components/settings-view";

export function SettingsPage() {
  return (
    <PageShell title="Settings">
      <SettingsView />
    </PageShell>
  );
}
