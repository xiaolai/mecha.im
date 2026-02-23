import { requireAuth } from "@/lib/require-auth";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();

  return <DashboardShell>{children}</DashboardShell>;
}
