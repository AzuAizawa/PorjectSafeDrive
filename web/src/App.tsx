import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/AppShell';

// Route-based code splitting — previously every one of these ~30 route
// components was imported eagerly in this file, so a renter's first visit
// downloaded the entire admin dashboard/analytics/audit/etc. bundle too
// (and vice versa for a staff member logging into /admin-login). Each
// named() helper below turns a named export into the default-export shape
// React.lazy() requires, without having to touch 30 route files just to
// add a `export default`.
function named<T extends ComponentType<any>>(promise: Promise<Record<string, T>>, exportName: string) {
  return promise.then((mod) => ({ default: mod[exportName] }));
}

const LoginPage = lazy(() => named(import('@/routes/login'), 'LoginPage'));
const AdminLoginPage = lazy(() => named(import('@/routes/admin-login'), 'AdminLoginPage'));
const ResetPasswordPage = lazy(() => named(import('@/routes/reset-password'), 'ResetPasswordPage'));
const PrivacyPage = lazy(() => named(import('@/routes/privacy'), 'PrivacyPage'));
const TermsPage = lazy(() => named(import('@/routes/terms'), 'TermsPage'));

const BrowsePage = lazy(() => named(import('@/routes/browse'), 'BrowsePage'));
const CarDetailPage = lazy(() => named(import('@/routes/car-detail'), 'CarDetailPage'));
const MyBookingsPage = lazy(() => named(import('@/routes/my-bookings'), 'MyBookingsPage'));
const InvoicePage = lazy(() => named(import('@/routes/invoice'), 'InvoicePage'));
const VerifyPage = lazy(() => named(import('@/routes/verify'), 'VerifyPage'));
const ProfilePage = lazy(() => named(import('@/routes/profile'), 'ProfilePage'));
const MyVehiclesPage = lazy(() => named(import('@/routes/my-vehicles'), 'MyVehiclesPage'));
const AddVehiclePage = lazy(() => named(import('@/routes/add-vehicle'), 'AddVehiclePage'));
const EditVehiclePage = lazy(() => named(import('@/routes/edit-vehicle'), 'EditVehiclePage'));
const BookingsReceivedPage = lazy(() => named(import('@/routes/bookings-received'), 'BookingsReceivedPage'));
const InquirePage = lazy(() => named(import('@/routes/inquire'), 'InquirePage'));
const HelpPage = lazy(() => named(import('@/routes/help'), 'HelpPage'));

const AdminDashboardPage = lazy(() => named(import('@/routes/admin/dashboard'), 'AdminDashboardPage'));
const AdminAnalyticsPage = lazy(() => named(import('@/routes/admin/analytics'), 'AdminAnalyticsPage'));
const AdminUsersPage = lazy(() => named(import('@/routes/admin/users'), 'AdminUsersPage'));
const AdminVehiclesPage = lazy(() => named(import('@/routes/admin/vehicles'), 'AdminVehiclesPage'));
const AdminCatalogPage = lazy(() => named(import('@/routes/admin/catalog'), 'AdminCatalogPage'));
const AdminDisputesPage = lazy(() => named(import('@/routes/admin/disputes'), 'AdminDisputesPage'));
const AdminPaymentsPage = lazy(() => named(import('@/routes/admin/payments'), 'AdminPaymentsPage'));
const AdminAuditPage = lazy(() => named(import('@/routes/admin/audit'), 'AdminAuditPage'));
const AdminSecurityLogPage = lazy(() => named(import('@/routes/admin/security-log'), 'AdminSecurityLogPage'));
const AdminSettingsPage = lazy(() => named(import('@/routes/admin/settings'), 'AdminSettingsPage'));
const AdminCompanyInfoPage = lazy(() => named(import('@/routes/admin/company-info'), 'AdminCompanyInfoPage'));
const AdminInquiriesPage = lazy(() => named(import('@/routes/admin/inquiries'), 'AdminInquiriesPage'));
const AdminRoleManagementPage = lazy(() => named(import('@/routes/admin/role-management'), 'AdminRoleManagementPage'));

function PageLoading() {
  return <p className="p-8 text-muted">Loading…</p>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <PageLoading />;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Inverse of RequireAuth, for /login and /admin-login. Without this, an
// already-authenticated session (e.g. pressing the browser Back button right
// after finishing login, which returns to /login's history entry) remounted
// a blank/stale login form instead of just taking the user back into the
// app — confusing at best, and on some paths left the last-rendered MFA
// step visible for a session that had already passed it.
function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <PageLoading />;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Single source of truth for "where does this role land" — used both by the
// index route and by every guard's redirect target, so they can never drift.
// Super Admin lands on the same Dashboard as Admin/Support, since it now has
// full operational access too — Role Management is just one more nav item,
// not the account's only reason to exist.
function homeRouteFor(role: string | undefined) {
  if (role === 'admin' || role === 'support' || role === 'super_admin') return '/admin';
  return '/browse';
}

function LandingRedirect() {
  const { profile } = useAuth();
  if (!profile) return <PageLoading />;
  return <Navigate to={homeRouteFor(profile.role)} replace />;
}

// Generic role gate — pass the roles allowed to see this route. Every admin
// page uses this now instead of separate Staff/FullAdmin components, so the
// 3-tier model (support/admin/super_admin) can mix and match per page.
function RequireRole({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { profile } = useAuth();
  if (profile && !roles.includes(profile.role)) return <Navigate to={homeRouteFor(profile.role)} replace />;
  return <>{children}</>;
}

// The inverse of RequireRole: blocks staff (admin/support/super_admin) from
// the renter/lister marketplace entirely. Staff accounts must never book,
// list, or rent a vehicle — by design, for the same reason a bank teller
// doesn't use their own teller login to open a personal savings account.
// Previously nothing enforced this: /browse, /cars/:id, etc. had zero role
// check, so a staff account that landed here (every login did, via the
// hardcoded /browse redirect) could fully use the marketplace.
function RequireRenter({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const isStaff = profile && ['admin', 'support', 'super_admin'].includes(profile.role);
  if (isStaff) return <Navigate to={homeRouteFor(profile!.role)} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>} />
        <Route path="/admin-login" element={<RedirectIfAuthenticated><AdminLoginPage /></RedirectIfAuthenticated>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />

        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<LandingRedirect />} />
          <Route path="browse" element={<RequireRenter><BrowsePage /></RequireRenter>} />
          <Route path="cars/:id" element={<RequireRenter><CarDetailPage /></RequireRenter>} />
          <Route path="bookings" element={<RequireRenter><MyBookingsPage /></RequireRenter>} />
          <Route path="invoice/:bookingId" element={<RequireRenter><InvoicePage /></RequireRenter>} />
          <Route path="verify" element={<RequireRenter><VerifyPage /></RequireRenter>} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="inquire" element={<InquirePage />} />
          <Route path="help" element={<HelpPage />} />

          <Route path="my-vehicles" element={<RequireRenter><MyVehiclesPage /></RequireRenter>} />
          <Route path="my-vehicles/new" element={<RequireRenter><AddVehiclePage /></RequireRenter>} />
          <Route path="my-vehicles/:id/edit" element={<RequireRenter><EditVehiclePage /></RequireRenter>} />
          <Route path="bookings-received" element={<RequireRenter><BookingsReceivedPage /></RequireRenter>} />

          <Route path="admin" element={<RequireRole roles={['support', 'admin', 'super_admin']}><AdminDashboardPage /></RequireRole>} />
          <Route path="admin/analytics" element={<RequireRole roles={['support', 'admin', 'super_admin']}><AdminAnalyticsPage /></RequireRole>} />
          <Route path="admin/users" element={<RequireRole roles={['support', 'admin', 'super_admin']}><AdminUsersPage /></RequireRole>} />
          <Route path="admin/vehicles" element={<RequireRole roles={['support', 'admin', 'super_admin']}><AdminVehiclesPage /></RequireRole>} />
          <Route path="admin/disputes" element={<RequireRole roles={['support', 'admin', 'super_admin']}><AdminDisputesPage /></RequireRole>} />
          <Route path="admin/inquiries" element={<RequireRole roles={['support', 'admin', 'super_admin']}><AdminInquiriesPage /></RequireRole>} />
          <Route path="admin/catalog" element={<RequireRole roles={['admin', 'super_admin']}><AdminCatalogPage /></RequireRole>} />
          <Route path="admin/payments" element={<RequireRole roles={['admin', 'super_admin']}><AdminPaymentsPage /></RequireRole>} />
          <Route path="admin/audit" element={<RequireRole roles={['admin', 'super_admin']}><AdminAuditPage /></RequireRole>} />
          <Route path="admin/security-log" element={<RequireRole roles={['admin', 'super_admin']}><AdminSecurityLogPage /></RequireRole>} />
          <Route path="admin/settings" element={<RequireRole roles={['admin', 'super_admin']}><AdminSettingsPage /></RequireRole>} />
          <Route path="admin/company-info" element={<RequireRole roles={['admin', 'super_admin']}><AdminCompanyInfoPage /></RequireRole>} />
          <Route path="admin/role-management" element={<RequireRole roles={['super_admin']}><AdminRoleManagementPage /></RequireRole>} />
        </Route>

        <Route path="*" element={<Navigate to="/browse" replace />} />
      </Routes>
    </Suspense>
  );
}
