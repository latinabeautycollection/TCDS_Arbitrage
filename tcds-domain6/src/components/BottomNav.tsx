import { NavLink } from 'react-router-dom';
import { bottomNavRoutes } from '../config/routes';

export function BottomNav() {
  return (
    <nav className="fixed bottom-11 left-0 right-0 z-20 px-3 pb-2" aria-label="Primary warehouse navigation">
      <div className="mx-auto grid max-w-md grid-cols-6 gap-1 rounded-[1.6rem] border border-tcds-line bg-white/96 p-1.5 shadow-floating backdrop-blur-2xl">
        {bottomNavRoutes.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) => `enterprise-motion relative flex flex-col items-center gap-1 rounded-enterprise px-1 py-2 text-[10px] font-black ${isActive ? 'scale-[1.03] bg-tcds-black text-tcds-gold shadow-gold' : 'text-tcds-muted hover:bg-tcds-surface'}`}
          >
            {({ isActive }) => <>
              <Icon size={isActive ? 19 : 18} />
              <span>{label.split(' ')[0]}</span>
              {isActive && <span className="absolute bottom-1 h-0.5 w-5 rounded-full bg-tcds-gold" />}
            </>}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
