import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { StatusStrip } from '../components/StatusStrip';

export function AppLayout() {
  const location = useLocation();
  const isLogin = location.pathname === '/';
  return (
    <div className="min-h-screen bg-tcds-surface text-tcds-ink">
      <main className={isLogin ? '' : 'pb-36'}>
        <Outlet />
      </main>
      {!isLogin && <BottomNav />}
      <StatusStrip />
    </div>
  );
}
