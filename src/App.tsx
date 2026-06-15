import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import BrdWorkspacePage from './pages/BrdWorkspacePage';
import AdminChannelsPage from './pages/AdminChannelsPage';
import AdminSettingsPage from './pages/AdminSettingsPage';
import AdminPromptsPage from './pages/AdminPromptsPage';
import AdminReportsPage from './pages/AdminReportsPage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { Toaster } from './components/shared/Toaster';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/brd/:id"
          element={
            <ProtectedRoute>
              <BrdWorkspacePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/channels"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminChannelsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminSettingsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/prompts"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminPromptsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/reports"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminReportsPage />
            </ProtectedRoute>
          }
        />

        {/* /admin redirects to /admin/channels as the default admin entry point */}
        <Route path="/admin" element={<Navigate to="/admin/channels" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toaster />
    </>
  );
}
