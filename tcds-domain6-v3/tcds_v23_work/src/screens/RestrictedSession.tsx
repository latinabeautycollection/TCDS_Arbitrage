import { LockKeyhole, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenCard } from '../components/ScreenCard';
import { brand } from '../config/brand';
import { useAuth } from '../features/auth/context/AuthContext';

// Shown when the signed-in account must change its password before using the app (restricted session).
export function RestrictedSession() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="safe-top safe-bottom flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        <header className="text-center">
          <BrandMark />
          <h1 className="mt-4 font-display text-3xl font-black tracking-tight text-tcds-ink">Password change required</h1>
        </header>
        <ScreenCard>
          <div className="flex items-start gap-3">
            <LockKeyhole className="mt-1 shrink-0 text-tcds-gold" size={22} />
            <div className="space-y-2 text-sm font-semibold text-tcds-muted">
              <p>Your password must be changed before you can use the warehouse app.</p>
              <p>{brand.supportLabel} to have your password reset.</p>
            </div>
          </div>
          <div className="mt-5">
            <PrimaryButton type="button" onClick={async () => { await logout().catch(() => {}); navigate('/', { replace: true }); }}>
              <LogOut size={18} /> Sign out
            </PrimaryButton>
          </div>
        </ScreenCard>
      </div>
    </div>
  );
}
