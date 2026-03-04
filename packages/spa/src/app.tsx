import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/auth-context";
import { DashboardLayout } from "@/pages/dashboard-layout";
import { HomePage } from "@/pages/home";
import { CasaDetailPage } from "@/pages/casa-detail";
import { TerminalPage } from "@/pages/terminal";
import { SessionDetailPage } from "@/pages/session-detail";
import { AclPage } from "@/pages/acl";
import { AuditPage } from "@/pages/audit";
import { MeshPage } from "@/pages/mesh";
import { SettingsPage } from "@/pages/settings";
import { LoginPage } from "@/pages/login";

export function App() {
  const { authenticated, loading } = useAuth();

  if (loading) return null;

  if (!authenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<HomePage />} />
        <Route path="casa/:name" element={<CasaDetailPage />} />
        <Route path="casa/:name/session/:id" element={<SessionDetailPage />} />
        <Route path="casa/:name/terminal" element={<TerminalPage />} />
        <Route path="mesh" element={<MeshPage />} />
        <Route path="acl" element={<AclPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
