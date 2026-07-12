import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { DesktopSupervisorRail } from '../components/DesktopSupervisorRail';
import { StatusStrip } from '../components/StatusStrip';

export function AppLayout() {
  const location = useLocation();
  const isLogin = location.pathname === '/';
  return (
    <div className="relative min-h-screen bg-tcds-surface text-tcds-ink">
      <div className="brand-watermark" aria-hidden="true" />
      {!isLogin && <DesktopSupervisorRail />}
      <main className={`relative z-[1] ${isLogin ? '' : 'pb-36'}`}>
        <Outlet />
      </main>
      {!isLogin && <BottomNav />}
      <StatusStrip />
    </div>
  );
}
