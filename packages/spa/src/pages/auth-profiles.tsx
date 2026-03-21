import { PageShell } from "@/components/page-shell";
import { AuthProfilesView } from "@/components/auth-profiles-view";

/** Auth profiles page for managing authentication configurations. */
export function AuthProfilesPage() {
  return (
    <PageShell title="Auth Profiles">
      <AuthProfilesView />
    </PageShell>
  );
}
