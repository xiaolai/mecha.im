import { SettingsView } from "@/components/settings-view";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">Settings</h1>
      <SettingsView />
    </div>
  );
}
