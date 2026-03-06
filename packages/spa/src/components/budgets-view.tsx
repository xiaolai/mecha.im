import { useState } from "react";
import { PlusIcon, Trash2Icon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

interface BudgetLimit {
  dailyUsd?: number;
  monthlyUsd?: number;
}

interface BudgetConfig {
  global: BudgetLimit;
  byBot: Record<string, BudgetLimit>;
  byAuthProfile: Record<string, BudgetLimit>;
  byTag: Record<string, BudgetLimit>;
}

/** Displays active budgets as cards with a form to set new budgets. */
export function BudgetsView() {
  const { data: config, loading, error, refetch } = useFetch<BudgetConfig>("/budgets");
  const { authHeaders } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [scope, setScope] = useState("global");
  const [name, setName] = useState("");
  const [daily, setDaily] = useState("");
  const [monthly, setMonthly] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSet() {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { scope };
      if (scope !== "global") body.name = name;
      if (daily) body.daily = parseFloat(daily);
      if (monthly) body.monthly = parseFloat(monthly);

      await fetch("/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify(body),
      });
      setShowForm(false);
      setDaily("");
      setMonthly("");
      setName("");
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(budgetScope: string, budgetName: string | undefined, period: string) {
    const params = new URLSearchParams({ scope: budgetScope, period });
    if (budgetName) params.set("name", budgetName);
    await fetch(`/budgets?${params}`, {
      method: "DELETE",
      headers: authHeaders,
      credentials: "include",
    });
    refetch();
  }

  if (loading && !config) return <Skeleton className="h-48 rounded-lg" />;
  if (error)
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );

  // Flatten budgets into a list for display
  const items: Array<{ scope: string; name?: string; limit: BudgetLimit }> = [];
  if (config) {
    if (config.global.dailyUsd != null || config.global.monthlyUsd != null)
      items.push({ scope: "global", limit: config.global });
    for (const [n, l] of Object.entries(config.byBot)) items.push({ scope: "bot", name: n, limit: l });
    for (const [n, l] of Object.entries(config.byAuthProfile))
      items.push({ scope: "auth-profile", name: n, limit: l });
    for (const [n, l] of Object.entries(config.byTag)) items.push({ scope: "tag", name: n, limit: l });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{items.length} active budget(s)</p>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <PlusIcon className="size-4" /> Set Budget
        </Button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="global">Global</option>
                <option value="bot">Bot</option>
                <option value="auth-profile">Auth Profile</option>
                <option value="tag">Tag</option>
              </select>
            </div>
            {scope !== "global" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={scope === "bot" ? "alice" : scope === "tag" ? "web" : "default"}
                  className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Daily Limit (USD)</label>
              <input
                type="number"
                step="0.01"
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
                placeholder="10.00"
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Monthly Limit (USD)</label>
              <input
                type="number"
                step="0.01"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                placeholder="100.00"
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={(!daily && !monthly) || submitting} onClick={handleSet}>
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No budgets configured.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const label = item.scope === "global" ? "Global" : `${item.scope}: ${item.name}`;
            return (
              <div
                key={`${item.scope}-${item.name ?? "global"}`}
                className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-card-foreground">{label}</span>
                </div>
                {item.limit.dailyUsd != null && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Daily: ${item.limit.dailyUsd.toFixed(2)}</span>
                    <TooltipIconButton
                      tooltip="Remove daily limit"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleRemove(item.scope, item.name, "daily")}
                    >
                      <Trash2Icon className="size-3" />
                    </TooltipIconButton>
                  </div>
                )}
                {item.limit.monthlyUsd != null && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Monthly: ${item.limit.monthlyUsd.toFixed(2)}</span>
                    <TooltipIconButton
                      tooltip="Remove monthly limit"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleRemove(item.scope, item.name, "monthly")}
                    >
                      <Trash2Icon className="size-3" />
                    </TooltipIconButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
