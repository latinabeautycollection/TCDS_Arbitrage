import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '../layouts/AppLayout';
import { Login } from '../screens/Login';
import { Dashboard } from '../screens/Dashboard';
import { ReceiveScreen } from '../features/receiving/ReceiveScreen';
import { ReturnsScreen } from '../features/returns/ReturnsScreen';
import { SupervisorConsoleScreen } from '../features/supervisor/SupervisorConsoleScreen';
import { PackShipScreen } from '../features/packShip/PackShipScreen';
import { InventoryListScreen } from '../features/inventory/InventoryListScreen';
import { InventoryDetailScreen } from '../features/inventory/InventoryDetailScreen';
import { PickInProgressScreen } from '../features/picking/PickInProgressScreen';
import { PhotosScreen } from '../features/photos/PhotosScreen';
import { VerificationScreen } from '../features/verification/VerificationScreen';
import { StorageAssignmentScreen } from '../features/storage/StorageAssignmentScreen';
import { ProtectedRoute } from '../features/auth/routes/ProtectedRoute';

const protect = (element: JSX.Element) => <ProtectedRoute>{element}</ProtectedRoute>;

export const router = createBrowserRouter([
  { path: '/', element: <AppLayout />, children: [
    { index: true, element: <Login /> },
    { path: 'dashboard', element: protect(<Dashboard />) },
    { path: 'receive', element: protect(<ReceiveScreen />) },
    { path: 'photos', element: protect(<PhotosScreen />) },
    { path: 'verify', element: protect(<VerificationScreen />) },
    { path: 'storage', element: protect(<StorageAssignmentScreen />) },
    { path: 'inventory', element: protect(<InventoryListScreen />) },
    { path: 'inventory/detail', element: protect(<InventoryDetailScreen />) },
    { path: 'pick', element: protect(<PickInProgressScreen />) },
    { path: 'pack-ship', element: protect(<PackShipScreen />) },
    { path: 'returns', element: protect(<ReturnsScreen />) },
    { path: 'settings', element: protect(<SupervisorConsoleScreen />) },
    { path: '*', element: <Navigate to="/dashboard" replace /> }
  ]}
]);
