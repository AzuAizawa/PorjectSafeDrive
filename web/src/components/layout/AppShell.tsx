import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar } from '@/components/ui/avatar';
import { NotificationBell } from '@/components/notification-bell';

const renterNav = [
  { to: '/browse', label: 'Browse Cars' },
  { to: '/bookings', label: 'My Bookings' },
];

const listerNav = [
  ...renterNav,
  { to: '/my-vehicles', label: 'My Vehicles' },
  { to: '/bookings-received', label: 'Bookings Received' },
];

// fullAdminOnly items are hidden entirely for the support role, matching the
// backend: support can't touch settings, payouts/refunds, catalog, or audit.
const adminNav = [
  { to: '/admin', label: 'Dashboard', fullAdminOnly: false },
  { to: '/admin/analytics', label: 'Analytics', fullAdminOnly: false },
  { to: '/admin/users', label: 'Users', fullAdminOnly: false },
  { to: '/admin/vehicles', label: 'Vehicle Approval', fullAdminOnly: false },
  { to: '/admin/disputes', label: 'Disputes', fullAdminOnly: false },
  { to: '/admin/inquiries', label: 'Inquiries', fullAdminOnly: false },
  { to: '/admin/catalog', label: 'Car Catalog', fullAdminOnly: true },
  { to: '/admin/payments', label: 'Send Payments', fullAdminOnly: true },
  { to: '/admin/audit', label: 'Audit Trail', fullAdminOnly: true },
  { to: '/admin/settings', label: 'Settings', fullAdminOnly: true },
  { to: '/admin/company-info', label: 'Company Info', fullAdminOnly: true },
];

export function AppShell() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const isStaff = profile?.role === 'admin' || profile?.role === 'support';
  const isFullAdmin = profile?.role === 'admin';
  const nav = isStaff
    ? adminNav.filter((item) => !item.fullAdminOnly || isFullAdmin)
    : profile?.is_lister
      ? listerNav
      : renterNav;

  async function toggleLister() {
    if (!profile) return;
    await supabase.from('profiles').update({ is_lister: !profile.is_lister }).eq('id', profile.id);
    await refreshProfile();
    setMenuOpen(false);
    navigate(profile.is_lister ? '/browse' : '/my-vehicles');
  }

  return (
    <div className="grid min-h-screen grid-cols-[232px_1fr] grid-rows-[56px_1fr]">
      <header className="glass sticky top-0 z-40 col-span-2 row-start-1 flex items-center justify-between border-b border-line/70 px-5">
        <div className="flex items-center gap-2.5 font-bold text-base">
          <span className="btn-gradient-accent grid h-6.5 w-6.5 place-items-center rounded-lg text-xs text-white shadow-[0_4px_12px_-4px_rgba(var(--shadow-tint),0.6)]">SD</span>
          SafeDrive
        </div>

        {!isStaff ? (
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {profile ? <NotificationBell userId={profile.id} /> : null}
            <NavLink
              to="/inquire"
              className={({ isActive }) =>
                cn(
                  'grid h-8.5 w-8.5 place-items-center rounded-full border border-line bg-surface/80 text-base hover:-translate-y-px hover:shadow-md',
                  isActive && 'border-accent bg-accent-soft'
                )
              }
              title="Inquire — ask support a question"
              aria-label="Inquire — ask support a question"
            >
              💬
            </NavLink>
            <div className="relative">
            <button
              className="rounded-full outline-none hover:-translate-y-px"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Profile menu"
            >
              {profile?.avatar_url ? (
                <Avatar avatarPath={profile.avatar_url} firstName={profile.first_name} lastName={profile.last_name} size="sm" />
              ) : (
                <span className="btn-gradient-accent grid h-8.5 w-8.5 place-items-center rounded-full text-xs font-bold text-white shadow-[0_4px_12px_-4px_rgba(var(--shadow-tint),0.6)]">
                  {profile?.first_name?.[0] ?? profile?.email?.[0]?.toUpperCase() ?? '·'}
                </span>
              )}
            </button>
            {menuOpen ? (
              <div className="glass animate-[dropdown-in_160ms_cubic-bezier(0.22,1,0.36,1)] absolute right-0 top-11 z-50 w-52 rounded-xl border border-line/70 p-1.5 shadow-xl">
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
                <NavLink
                  to="/help"
                  className="block rounded-md px-2.5 py-2 text-[13px] font-medium hover:bg-surface-2"
                  onClick={() => setMenuOpen(false)}
                >
                  ❓ Help
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
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {profile ? <NotificationBell userId={profile.id} /> : null}
            <button
              className="rounded-full border border-line bg-accent-soft px-3 py-1 text-xs font-bold text-accent-strong hover:-translate-y-px hover:shadow-md"
              onClick={() => supabase.auth.signOut()}
            >
              Log out
            </button>
          </div>
        )}
      </header>

      <aside className="glass sticky top-14 row-start-2 h-[calc(100vh-56px)] overflow-y-auto border-r border-line/70 p-3">
        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              className={({ isActive }) =>
                cn(
                  'relative rounded-lg px-2.5 py-2 text-[13.5px] font-semibold text-muted hover:bg-surface-2 hover:text-ink',
                  isActive &&
                    'bg-accent-soft text-accent-strong before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-accent'
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
