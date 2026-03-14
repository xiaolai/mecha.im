import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const base =
  "bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
};

export function Input({ mono, className = "", ...props }: InputProps) {
  return (
    <input
      className={`${base} px-3 py-1.5 ${mono ? "font-mono" : ""} ${className}`}
      {...props}
    />
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  compact?: boolean;
};

export function Select({ compact, className = "", children, ...props }: SelectProps) {
  return (
    <select
      className={`${base} ${compact ? "px-2 py-1" : "px-3 py-1.5"} ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean;
};

export function Textarea({ mono, className = "", ...props }: TextareaProps) {
  return (
    <textarea
      className={`${base} px-3 py-2 resize-y ${mono ? "font-mono" : ""} ${className}`}
      {...props}
    />
  );
}
