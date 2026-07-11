import { NavLink } from 'react-router-dom';
import { bottomNavRoutes } from '../config/routes';

export function BottomNav() {
  return (
    <nav className="fixed bottom-11 left-0 right-0 z-20 px-3 pb-2">
      <div className="mx-auto grid max-w-md grid-cols-6 gap-1 rounded-[1.6rem] border border-tcds-line bg-white/94 p-1.5 shadow-executive backdrop-blur-2xl">
        {bottomNavRoutes.map(({ path, label, icon: Icon }) => (
          <NavLink key={path} to={path} className={({ isActive }) => `enterprise-motion flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-black ${isActive ? 'bg-tcds-black text-tcds-gold shadow-soft' : 'text-tcds-muted'}`}>
            <Icon size={18} />
            <span>{label.split(' ')[0]}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
