import { PageShell } from "@/components/page-shell";
import { BudgetsView } from "@/components/budgets-view";

export function BudgetsPage() {
  return (
    <PageShell title="Budgets">
      <BudgetsView />
    </PageShell>
  );
}
