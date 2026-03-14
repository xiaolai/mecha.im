import type { ReactNode } from "react";

const styles = {
  success: "bg-green-500/10 text-green-600 dark:text-green-400",
  error: "bg-destructive/10 text-destructive",
} as const;

type Props = {
  variant: keyof typeof styles;
  children: ReactNode;
  className?: string;
  onDismiss?: () => void;
};

export default function Alert({ variant, children, className = "", onDismiss }: Props) {
  return (
    <div className={`text-sm px-3 py-2 rounded-md ${styles[variant]} ${className}`}>
      {children}
      {onDismiss && (
        <button onClick={onDismiss} className="ml-2 underline">dismiss</button>
      )}
    </div>
  );
}
