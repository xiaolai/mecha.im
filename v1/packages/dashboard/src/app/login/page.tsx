import { LoginForm } from "@/components/LoginForm";
import { isAuthEnabled, getSessionFromCookies, validateSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  // If auth is not enabled, skip login
  if (!isAuthEnabled()) {
    redirect("/");
  }

  // If already logged in, redirect home
  const sessionId = await getSessionFromCookies();
  if (sessionId && validateSession(sessionId)) {
    redirect("/");
  }

  return <LoginForm />;
}
