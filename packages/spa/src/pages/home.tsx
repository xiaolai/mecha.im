import { CasaList } from "@/components/casa-list";
import { MeterSummary } from "@/components/meter-summary";

export function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <MeterSummary />
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-foreground">CASAs</h1>
        <CasaList />
      </div>
    </div>
  );
}
