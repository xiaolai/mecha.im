import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardLayout } from "@/pages/dashboard-layout";
import { HomePage } from "@/pages/home";
import { BotDetailPage } from "@/pages/bot-detail";
import { TerminalPage } from "@/pages/terminal";
import { SessionDetailPage } from "@/pages/session-detail";
import { AclPage } from "@/pages/acl";
import { AuditPage } from "@/pages/audit";
import { NodesPage } from "@/pages/nodes";
import { SettingsPage } from "@/pages/settings";
import { SchedulesPage } from "@/pages/schedules-page";
import { LoginPage } from "@/pages/login";
import { NotFoundPage } from "@/pages/not-found";

export function App() {
  const { authenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>
    );
  }

  if (!authenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<HomePage />} />
        <Route path="bot/:name" element={<BotDetailPage />} />
        <Route path="bot/:name/session/:id" element={<SessionDetailPage />} />
        <Route path="bot/:name/terminal" element={<TerminalPage />} />
        <Route path="nodes" element={<NodesPage />} />
        {/* Legacy route redirect */}
        <Route path="mesh" element={<Navigate to="/nodes" replace />} />
        <Route path="schedules" element={<SchedulesPage />} />
        <Route path="acl" element={<AclPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
