import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Menu, X, MessageCircle, User, IdCard, HelpCircle, Repeat, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar } from '@/components/ui/avatar';
import { NotificationBell } from '@/components/notification-bell';
import { MandatoryMfaGate } from '@/components/mandatory-mfa-gate';

const renterNav = [
  { to: '/browse', label: 'Browse Cars' },
  { to: '/bookings', label: 'My Bookings' },
];

const listerNav = [
  ...renterNav,
  { to: '/my-vehicles', label: 'My Vehicles' },
  { to: '/bookings-received', label: 'Bookings Received' },
];

// Each item lists which roles can see it, matching the backend's RequireRole
// route guards and RPC checks exactly. Super Admin is a strict superset of
// Admin (sees everything Admin does, plus the identity/access-only Role
// Management page) — matches how "Super Admin"/"Owner" reads in the
// products most people actually reference (Okta, Google Workspace, GitHub,
// Stripe), rather than a role with LESS power than a regular Admin.
const adminNav = [
  { to: '/admin', label: 'Dashboard', roles: ['support', 'admin', 'super_admin'] },
  { to: '/admin/analytics', label: 'Analytics', roles: ['support', 'admin', 'super_admin'] },
  { to: '/admin/users', label: 'Users', roles: ['support', 'admin', 'super_admin'] },
  { to: '/admin/vehicles', label: 'Vehicle Approval', roles: ['support', 'admin', 'super_admin'] },
  { to: '/admin/disputes', label: 'Disputes', roles: ['support', 'admin', 'super_admin'] },
  { to: '/admin/inquiries', label: 'Inquiries', roles: ['support', 'admin', 'super_admin'] },
  { to: '/admin/catalog', label: 'Car Catalog', roles: ['admin', 'super_admin'] },
  { to: '/admin/payments', label: 'Send Payments', roles: ['admin', 'super_admin'] },
  { to: '/admin/audit', label: 'Audit Trail', roles: ['admin', 'super_admin'] },
  { to: '/admin/security-log', label: 'Security Log', roles: ['admin', 'super_admin'] },
  { to: '/admin/settings', label: 'Settings', roles: ['admin', 'super_admin'] },
  { to: '/admin/company-info', label: 'Company Info', roles: ['admin', 'super_admin'] },
  { to: '/admin/role-management', label: 'Role Management', roles: ['super_admin'] },
];

export function AppShell() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const isStaff = profile?.role === 'admin' || profile?.role === 'support' || profile?.role === 'super_admin';
  const nav = isStaff
    ? adminNav.filter((item) => profile && item.roles.includes(profile.role))
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

  const shell = (
    <div className="grid min-h-screen grid-cols-[232px_1fr] grid-rows-[56px_1fr] max-[860px]:grid-cols-1">
      <header className="glass sticky top-0 z-40 col-span-2 row-start-1 flex items-center justify-between border-b border-line/70 px-5 max-[860px]:col-span-1 max-[860px]:px-3.5">
        <div className="flex items-center gap-2.5 font-bold text-base">
          <button
            className="hidden -ml-1 mr-0.5 h-8.5 w-8.5 place-items-center rounded-md border border-line bg-surface/80 text-base max-[860px]:grid"
            onClick={() => setNavOpen((o) => !o)}
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
          >
            {navOpen ? <X className="h-4 w-4" strokeWidth={2.25} /> : <Menu className="h-4 w-4" strokeWidth={2.25} />}
          </button>
          <span className="btn-gradient-accent grid h-6.5 w-6.5 place-items-center rounded-lg text-xs text-white shadow-[0_4px_12px_-4px_rgba(var(--shadow-tint),0.6)]">SD</span>
          <span className="max-[420px]:hidden">SafeDrive</span>
        </div>

        {!isStaff ? (
          <div className="flex items-center gap-2 max-[420px]:gap-1">
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
              <MessageCircle className="h-4 w-4" strokeWidth={2.25} />
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
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium hover:bg-surface-2"
                  onClick={() => setMenuOpen(false)}
                >
                  <User className="h-4 w-4 text-muted" strokeWidth={2.25} /> My Profile
                </NavLink>
                <NavLink
                  to="/verify"
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium hover:bg-surface-2"
                  onClick={() => setMenuOpen(false)}
                >
                  <IdCard className="h-4 w-4 text-muted" strokeWidth={2.25} /> Get Verified
                </NavLink>
                <NavLink
                  to="/help"
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium hover:bg-surface-2"
                  onClick={() => setMenuOpen(false)}
                >
                  <HelpCircle className="h-4 w-4 text-muted" strokeWidth={2.25} /> Help
                </NavLink>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium hover:bg-surface-2"
                  onClick={toggleLister}
                >
                  <Repeat className="h-4 w-4 text-muted" strokeWidth={2.25} /> {profile?.is_lister ? 'Switch to Renter' : 'Switch to Lister'}
                </button>
                <hr className="my-1 border-line" />
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium hover:bg-surface-2 hover:text-bad"
                  onClick={() => supabase.auth.signOut()}
                >
                  <LogOut className="h-4 w-4 text-muted" strokeWidth={2.25} /> Log out
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

      {navOpen ? (
        <div
          className="fixed inset-0 z-40 hidden bg-black/50 backdrop-blur-sm animate-[overlay-in_180ms_ease] max-[860px]:block"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          'glass sticky top-14 row-start-2 h-[calc(100vh-56px)] overflow-y-auto border-r border-line/70 p-3',
          'max-[860px]:fixed max-[860px]:inset-y-0 max-[860px]:top-0 max-[860px]:z-50 max-[860px]:h-screen max-[860px]:w-64',
          'max-[860px]:shadow-2xl max-[860px]:transition-transform max-[860px]:duration-300',
          navOpen ? 'max-[860px]:translate-x-0' : 'max-[860px]:-translate-x-full'
        )}
      >
        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              onClick={() => setNavOpen(false)}
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

      <main className="row-start-2 max-w-[1180px] px-8 py-7 max-[860px]:px-4 max-[860px]:py-5">
        <Outlet />
      </main>
    </div>
  );

  // Two-factor authentication is mandatory for every account, not just
  // staff — see mandatory-mfa-gate.tsx for the full rationale.
  return <MandatoryMfaGate>{shell}</MandatoryMfaGate>;
}
