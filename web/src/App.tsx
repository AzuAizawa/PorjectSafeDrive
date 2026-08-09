import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/routes/login';
import { AdminLoginPage } from '@/routes/admin-login';
import { ResetPasswordPage } from '@/routes/reset-password';
import { BrowsePage } from '@/routes/browse';
import { CarDetailPage } from '@/routes/car-detail';
import { MyBookingsPage } from '@/routes/my-bookings';
import { InvoicePage } from '@/routes/invoice';
import { VerifyPage } from '@/routes/verify';
import { ProfilePage } from '@/routes/profile';
import { MyVehiclesPage } from '@/routes/my-vehicles';
import { AddVehiclePage } from '@/routes/add-vehicle';
import { EditVehiclePage } from '@/routes/edit-vehicle';
import { BookingsReceivedPage } from '@/routes/bookings-received';
import { AdminUsersPage } from '@/routes/admin/users';
import { AdminVehiclesPage } from '@/routes/admin/vehicles';
import { AdminCatalogPage } from '@/routes/admin/catalog';
import { AdminDisputesPage } from '@/routes/admin/disputes';
import { AdminPaymentsPage } from '@/routes/admin/payments';
import { AdminAuditPage } from '@/routes/admin/audit';
import { AdminSecurityLogPage } from '@/routes/admin/security-log';
import { AdminSettingsPage } from '@/routes/admin/settings';
import { AdminDashboardPage } from '@/routes/admin/dashboard';
import { AdminAnalyticsPage } from '@/routes/admin/analytics';
import { InquirePage } from '@/routes/inquire';
import { HelpPage } from '@/routes/help';
import { AdminCompanyInfoPage } from '@/routes/admin/company-info';
import { AdminInquiriesPage } from '@/routes/admin/inquiries';
import { AdminRoleManagementPage } from '@/routes/admin/role-management';
import { PrivacyPage } from '@/routes/privacy';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="p-8 text-muted">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
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
  if (!profile) return <p className="p-8 text-muted">Loading…</p>;
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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin-login" element={<AdminLoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />

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
  );
}
