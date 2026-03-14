import type { ReactNode } from "react";

const styles = {
  success: "bg-green-500/10 text-green-600 dark:text-green-400",
  warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  error: "bg-destructive/10 text-destructive",
  primary: "bg-primary/10 text-primary",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  muted: "bg-muted text-muted-foreground",
} as const;

type Props = {
  variant?: keyof typeof styles;
  children: ReactNode;
  onRemove?: () => void;
  className?: string;
};

export default function Badge({ variant = "primary", children, onRemove, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${styles[variant]} ${className}`}
    >
      {children}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-destructive transition-colors ml-0.5">
          &times;
        </button>
      )}
    </span>
  );
}

/** Compact status badge (rounded-md, smaller padding) */
export function StatusBadge({ variant = "success", children, className = "" }: Omit<Props, "onRemove">) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${styles[variant]} ${className}`}>
      {children}
    </span>
  );
}
