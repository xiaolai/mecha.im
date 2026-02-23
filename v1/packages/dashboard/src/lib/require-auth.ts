import { redirect } from "next/navigation";
import { isAuthEnabled, getSessionFromCookies, validateSession } from "./auth";

/** Server-side auth gate for pages. Redirects to /login if not authenticated. */
export async function requireAuth(): Promise<void> {
  if (isAuthEnabled()) {
    const sessionId = await getSessionFromCookies();
    if (!sessionId || !validateSession(sessionId)) {
      redirect("/login");
    }
  }
}
