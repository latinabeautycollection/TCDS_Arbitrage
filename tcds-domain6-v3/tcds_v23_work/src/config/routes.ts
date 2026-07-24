import { Boxes, Camera, ClipboardCheck, Home, LogIn, MapPinned, PackageCheck, PackageSearch, RotateCcw, ScanLine, Settings, Truck } from 'lucide-react';

export const appRoutes = [
  { path: '/', label: 'Login', icon: LogIn, protected: false },
  { path: '/dashboard', label: 'Dashboard', icon: Home, protected: true },
  { path: '/receive', label: 'Receive', icon: ScanLine, protected: true },
  { path: '/photos', label: 'Photos', icon: Camera, protected: true },
  { path: '/verify', label: 'Verify', icon: ClipboardCheck, protected: true },
  { path: '/storage', label: 'Storage', icon: MapPinned, protected: true },
  { path: '/inventory', label: 'Inventory', icon: Boxes, protected: true },
  { path: '/inventory/detail', label: 'Item Detail', icon: PackageSearch, protected: true },
  { path: '/pick', label: 'Pick', icon: PackageCheck, protected: true },
  { path: '/pack-ship', label: 'Pack & Ship', icon: Truck, protected: true },
  { path: '/returns', label: 'Returns', icon: RotateCcw, protected: true },
  { path: '/settings', label: 'Settings', icon: Settings, protected: true }
] as const;

export const bottomNavRoutes = appRoutes.filter((r) => ['/dashboard','/receive','/inventory','/pick','/pack-ship','/returns'].includes(r.path));
