import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '../layouts/AppLayout';
import { Login } from '../screens/Login';
import { Dashboard } from '../screens/Dashboard';
import { Receive, Photos, Verify, Storage, Inventory, InventoryDetail, Pick, PackShip, Returns, Settings } from '../screens/GenericScreens';

function ProtectedShellRoute({ children }: { children: JSX.Element }) {
  // Shell phase only: route guard is intentionally permissive so the developer can view every screen.
  // Business-logic phase must replace this with real auth/session/device checks.
  const shellPreviewMode = true;
  return shellPreviewMode ? children : <Navigate to="/" replace />;
}

export const router = createBrowserRouter([
  { path: '/', element: <AppLayout />, children: [
    { index: true, element: <Login /> },
    { path: 'dashboard', element: <ProtectedShellRoute><Dashboard /></ProtectedShellRoute> },
    { path: 'receive', element: <ProtectedShellRoute><Receive /></ProtectedShellRoute> },
    { path: 'photos', element: <ProtectedShellRoute><Photos /></ProtectedShellRoute> },
    { path: 'verify', element: <ProtectedShellRoute><Verify /></ProtectedShellRoute> },
    { path: 'storage', element: <ProtectedShellRoute><Storage /></ProtectedShellRoute> },
    { path: 'inventory', element: <ProtectedShellRoute><Inventory /></ProtectedShellRoute> },
    { path: 'inventory/detail', element: <ProtectedShellRoute><InventoryDetail /></ProtectedShellRoute> },
    { path: 'pick', element: <ProtectedShellRoute><Pick /></ProtectedShellRoute> },
    { path: 'pack-ship', element: <ProtectedShellRoute><PackShip /></ProtectedShellRoute> },
    { path: 'returns', element: <ProtectedShellRoute><Returns /></ProtectedShellRoute> },
    { path: 'settings', element: <ProtectedShellRoute><Settings /></ProtectedShellRoute> },
    { path: '*', element: <Navigate to="/dashboard" replace /> }
  ]}
]);
