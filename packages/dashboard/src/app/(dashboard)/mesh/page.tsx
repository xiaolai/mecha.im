import { MeshView } from "@/components/mesh-view";
import { PageShell } from "@/components/page-shell";

export default function MeshPage() {
  return (
    <PageShell title="Mesh Nodes">
      <MeshView />
    </PageShell>
  );
}
