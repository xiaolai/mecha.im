/** Shared bot state → visual style mapping used across card and detail views. */
export const stateStyles = {
  running: { dot: "bg-success", badge: "success" as const },
  stopped: { dot: "bg-muted-foreground", badge: "secondary" as const },
  error: { dot: "bg-destructive", badge: "destructive" as const },
};
