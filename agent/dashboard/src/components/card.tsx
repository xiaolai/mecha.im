import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  compact?: boolean;
  spacing?: 2 | 3 | 4;
};

const spacingClass = { 2: "space-y-2", 3: "space-y-3", 4: "space-y-4" } as const;

export default function Card({ compact, spacing, className = "", children, ...props }: Props) {
  const pad = compact ? "p-3" : "p-4";
  const sp = spacing ? spacingClass[spacing] : "";
  return (
    <div
      className={`bg-card rounded-lg border border-border ${pad} ${sp} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
