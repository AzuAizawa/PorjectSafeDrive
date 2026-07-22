import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

const renterNav = [
  { to: '/browse', label: 'Browse Cars' },
  { to: '/bookings', label: 'My Bookings' },
];

const listerNav = [
  ...renterNav,
  { to: '/my-vehicles', label: 'My Vehicles' },
  { to: '/bookings-received', label: 'Bookings Received' },
];

const adminNav = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/vehicles', label: 'Vehicle Approval' },
  { to: '/admin/catalog', label: 'Car Catalog' },
  { to: '/admin/disputes', label: 'Disputes' },
  { to: '/admin/payments', label: 'Send Payments' },
  { to: '/admin/audit', label: 'Audit Trail' },
  { to: '/admin/settings', label: 'Settings' },
];

export function AppShell() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const nav = isAdmin ? adminNav : profile?.is_lister ? listerNav : renterNav;

  return (
    <div className="grid min-h-screen grid-cols-[232px_1fr] grid-rows-[56px_1fr]">
      <header className="col-span-2 row-start-1 flex items-center justify-between border-b border-line bg-surface px-5">
        <div className="flex items-center gap-2.5 font-bold text-base">
          <span className="grid h-6.5 w-6.5 place-items-center rounded-md bg-accent text-xs text-white">SD</span>
          SafeDrive
        </div>
        <button
          className="rounded-full border border-line bg-accent-soft px-3 py-1 text-xs font-bold text-accent-strong"
          onClick={() => supabase.auth.signOut()}
        >
          Log out
        </button>
      </header>

      <aside className="sticky top-14 row-start-2 h-[calc(100vh-56px)] overflow-y-auto border-r border-line bg-surface p-3">
        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-2.5 py-2 text-[13.5px] font-semibold text-muted hover:bg-surface-2 hover:text-ink',
                  isActive && 'bg-accent-soft text-accent-strong'
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="row-start-2 max-w-[1180px] px-8 py-7">
        <Outlet />
      </main>
    </div>
  );
}
