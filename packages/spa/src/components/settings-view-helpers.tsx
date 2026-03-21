import { cn } from "@/lib/utils";

export function formatMemory(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function InfoRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value == null) return null;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-card-foreground text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

export function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="size-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
    </div>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      {children}
    </div>
  );
}
