import { PageShell } from "@/components/page-shell";
import { SandboxView } from "@/components/sandbox-view";

/** Sandbox page for viewing and configuring bot sandbox settings. */
export function SandboxPage() {
  return (
    <PageShell title="Sandbox">
      <SandboxView />
    </PageShell>
  );
}
