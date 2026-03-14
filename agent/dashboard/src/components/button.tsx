import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  "destructive-soft":
    "bg-destructive/10 text-destructive hover:bg-destructive/20",
  ghost:
    "border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
  "ghost-destructive":
    "border border-destructive/30 text-destructive/70 hover:text-destructive hover:border-destructive",
} as const;

const sizes = {
  sm: "px-3 py-1.5 text-sm",
  lg: "px-4 py-2 text-sm",
  xs: "px-2 py-1 text-xs",
} as const;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export default function Button({
  variant = "primary",
  size = "sm",
  className = "",
  disabled,
  ...props
}: Props) {
  return (
    <button
      type="button"
      className={`${sizes[size]} ${variants[variant]} rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
      disabled={disabled}
      {...props}
    />
  );
}
