import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
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
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = profile?.role === 'admin';
  const nav = isAdmin ? adminNav : profile?.is_lister ? listerNav : renterNav;

  async function toggleLister() {
    if (!profile) return;
    await supabase.from('profiles').update({ is_lister: !profile.is_lister }).eq('id', profile.id);
    await refreshProfile();
    setMenuOpen(false);
    navigate(profile.is_lister ? '/browse' : '/my-vehicles');
  }

  return (
    <div className="grid min-h-screen grid-cols-[232px_1fr] grid-rows-[56px_1fr]">
      <header className="sticky top-0 z-40 col-span-2 row-start-1 flex items-center justify-between border-b border-line bg-surface px-5">
        <div className="flex items-center gap-2.5 font-bold text-base">
          <span className="grid h-6.5 w-6.5 place-items-center rounded-md bg-accent text-xs text-white">SD</span>
          SafeDrive
        </div>

        {!isAdmin ? (
          <div className="relative">
            <button
              className="grid h-8.5 w-8.5 place-items-center rounded-full border border-line bg-accent-soft text-xs font-bold text-accent-strong"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {profile?.first_name?.[0] ?? profile?.email?.[0]?.toUpperCase() ?? '·'}
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-11 z-50 w-52 rounded-md border border-line bg-surface p-1.5 shadow-lg">
                <NavLink
                  to="/profile"
                  className="block rounded-md px-2.5 py-2 text-[13px] font-medium hover:bg-surface-2"
                  onClick={() => setMenuOpen(false)}
                >
                  👤 My Profile
                </NavLink>
                <NavLink
                  to="/verify"
                  className="block rounded-md px-2.5 py-2 text-[13px] font-medium hover:bg-surface-2"
                  onClick={() => setMenuOpen(false)}
                >
                  🪪 Get Verified
                </NavLink>
                <button
                  className="block w-full rounded-md px-2.5 py-2 text-left text-[13px] font-medium hover:bg-surface-2"
                  onClick={toggleLister}
                >
                  🔁 {profile?.is_lister ? 'Switch to Renter' : 'Switch to Lister'}
                </button>
                <hr className="my-1 border-line" />
                <button
                  className="block w-full rounded-md px-2.5 py-2 text-left text-[13px] font-medium hover:bg-surface-2"
                  onClick={() => supabase.auth.signOut()}
                >
                  ↩ Log out
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <button
            className="rounded-full border border-line bg-accent-soft px-3 py-1 text-xs font-bold text-accent-strong"
            onClick={() => supabase.auth.signOut()}
          >
            Log out
          </button>
        )}
      </header>

      <aside className="sticky top-14 row-start-2 h-[calc(100vh-56px)] overflow-y-auto border-r border-line bg-surface p-3">
        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
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
