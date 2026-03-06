import { useState } from "react";
import { BotCard, type BotInfo } from "./bot-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/use-fetch";

interface BotListProps {
  node?: string;
}

export function BotList({ node }: BotListProps) {
  const url = node ? `/bots?node=${encodeURIComponent(node)}` : "/bots";
  const { data, loading, error } = useFetch<BotInfo[]>(url, { interval: 5000 });
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

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

  const allTags = [...new Set(bots.flatMap((b) => b.tags ?? []))].sort();
  const filtered = selectedTag ? bots.filter((b) => b.tags?.includes(selectedTag)) : bots;

  return (
    <>
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => setSelectedTag(null)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              selectedTag === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                selectedTag === tag
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((bot) => (
          <BotCard key={`${bot.node ?? "local"}-${bot.name}`} bot={bot} />
        ))}
      </div>
    </>
  );
}
