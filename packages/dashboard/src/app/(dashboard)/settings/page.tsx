import { SettingsView } from "@/components/settings-view";
import { PageShell } from "@/components/page-shell";

export default function SettingsPage() {
  return (
    <PageShell title="Settings">
      <SettingsView />
    </PageShell>
  );
}
