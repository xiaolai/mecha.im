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
import { BudgetsPage } from "@/pages/budgets";
import { AuthProfilesPage } from "@/pages/auth-profiles";
import { SandboxPage } from "@/pages/sandbox";
import { PluginsPage } from "@/pages/plugins";
import { ToolsPage } from "@/pages/tools";
import { DoctorPage } from "@/pages/doctor";
import { LoginPage } from "@/pages/login";
import { NotFoundPage } from "@/pages/not-found";

/** Root application component with route definitions and auth gate. */
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
        <Route path="budgets" element={<BudgetsPage />} />
        <Route path="auth" element={<AuthProfilesPage />} />
        <Route path="sandbox" element={<SandboxPage />} />
        <Route path="plugins" element={<PluginsPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="doctor" element={<DoctorPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
