import { CasaList } from "@/components/casa-list";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">CASAs</h1>
      <CasaList />
    </div>
  );
}
