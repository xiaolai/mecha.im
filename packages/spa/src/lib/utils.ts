import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names with tailwind-merge and clsx. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
