import { MeshView } from "@/components/mesh-view";

export default function MeshPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">Mesh Nodes</h1>
      <MeshView />
    </div>
  );
}
