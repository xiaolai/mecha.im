import type { ReactNode } from "react";

type Props = {
  open: boolean;
  size?: "sm" | "md";
  title: string;
  description?: string;
  children: ReactNode;
};

export default function Dialog({ open, size = "sm", title, description, children }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className={`bg-card border border-border rounded-lg p-6 ${size === "md" ? "max-w-md" : "max-w-sm"} mx-4 shadow-xl`}>
        <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground mb-4">{description}</p>
        )}
        {children}
      </div>
    </div>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 justify-end">{children}</div>;
}
