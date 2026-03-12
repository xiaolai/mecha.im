function currentDashboardPrefix(): string {
  if (typeof window === "undefined") return "";
  const marker = "/dashboard/";
  const pathname = window.location.pathname;
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) return "";
  return pathname.slice(0, markerIndex);
}

export function botUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${currentDashboardPrefix()}${normalized}`;
}

export function botFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(botUrl(path), { ...init, credentials: "same-origin" });
}
