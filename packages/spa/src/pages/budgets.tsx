import { PageShell } from "@/components/page-shell";
import { BudgetsView } from "@/components/budgets-view";

/** Budgets page for viewing and managing bot spending limits. */
export function BudgetsPage() {
  return (
    <PageShell title="Budgets">
      <BudgetsView />
    </PageShell>
  );
}
