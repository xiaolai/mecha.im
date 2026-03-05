import { BotCard, type BotInfo } from "./bot-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/lib/use-fetch";

interface BotListProps {
  node?: string;
}

export function BotList({ node }: BotListProps) {
  const url = node ? `/bots?node=${encodeURIComponent(node)}` : "/bots";
  const { data, loading, error } = useFetch<BotInfo[]>(url, { interval: 5000 });

  if (loading && !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const bots = data ?? [];

  if (bots.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {node ? `No bots on ${node}.` : "No bots running."}
        </p>
        {!node && (
          <p className="mt-1 text-xs text-muted-foreground">
            Use <code className="font-mono">mecha spawn</code> to create one.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {bots.map((bot) => (
        <BotCard key={`${bot.node ?? "local"}-${bot.name}`} bot={bot} />
      ))}
    </div>
  );
}
