import { PageShell } from "@/components/page-shell";
import { AuthProfilesView } from "@/components/auth-profiles-view";

export function AuthProfilesPage() {
  return (
    <PageShell title="Auth Profiles">
      <AuthProfilesView />
    </PageShell>
  );
}
