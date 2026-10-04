import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AdminLayout } from './layouts/AdminLayout';
import { ChatPage } from './pages/ChatPage';
import { LandingPage } from './pages/LandingPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useAuth, AuthProvider } from './hooks/useAuth';
import { useMetaTracking } from './hooks/useMetaTracking';
import { Spinner } from './components/ui/Button';

// Admin screens are code-split so the public chat page stays small.
const AdminLoginPage = lazy(() =>
  import('./pages/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })),
);
const AdminDashboardPage = lazy(() =>
  import('./pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })),
);
const AdminConversationPage = lazy(() =>
  import('./pages/AdminConversationPage').then((m) => ({ default: m.AdminConversationPage })),
);
const AdminSettingsPage = lazy(() =>
  import('./pages/AdminSettingsPage').then((m) => ({ default: m.AdminSettingsPage })),
);

/**
 * Renders nothing. Exists purely so the tracking effect has a component that
 * lives above the router and survives navigation between all routes.
 */
function MetaTracking() {
  useMetaTracking();
  return null;
}

function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100">
      <Spinner className="h-5 w-5 text-slate-400" />
    </div>
  );
}

/**
 * Route guard for every /admin/* page.
 *
 * UX only. Real authorisation is enforced by `requireAdmin` on the server for
 * every admin API call — bypassing this component yields nothing, because the
 * admin endpoints reject the request without a valid session cookie.
 */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100">
        <Spinner className="h-5 w-5 text-slate-400" />
      </div>
    );
  }

  if (status !== 'authenticated') {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      {/* Mounted once at the root; internally it no-ops on /admin/* routes. */}
      <MetaTracking />

      <Suspense fallback={<RouteFallback />}>
        <Routes>
        {/* `/chat` is the first-class entry point: a visitor is dropped
            straight into the chat. The landing page stays reachable at
            `/welcome` for marketing links that want the pitch first. */}
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/welcome" element={<LandingPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />

        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="conversations" element={<AdminDashboardPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>
        <Route
          path="/admin/conversations/:conversationId"
          element={
            <RequireAdmin>
              <AdminConversationPage />
            </RequireAdmin>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}