import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/routes/login';
import { ResetPasswordPage } from '@/routes/reset-password';
import { BrowsePage } from '@/routes/browse';
import { CarDetailPage } from '@/routes/car-detail';
import { MyBookingsPage } from '@/routes/my-bookings';
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
import { AdminSettingsPage } from '@/routes/admin/settings';
import { AdminDashboardPage } from '@/routes/admin/dashboard';
import { AdminAnalyticsPage } from '@/routes/admin/analytics';
import { InquirePage } from '@/routes/inquire';
import { HelpPage } from '@/routes/help';
import { AdminCompanyInfoPage } from '@/routes/admin/company-info';
import { AdminInquiriesPage } from '@/routes/admin/inquiries';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="p-8 text-muted">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Staff = admin or support — the lower-risk admin pages (dashboard, analytics,
// users, vehicle approval, disputes, inquiries).
function RequireStaff({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  if (profile && !['admin', 'support'].includes(profile.role)) return <Navigate to="/browse" replace />;
  return <>{children}</>;
}

// Full admin only — settings, payouts/refunds, catalog, audit trail. Support
// can't touch any of these, per the trust & safety brainstorm decision.
function RequireFullAdmin({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  if (profile && profile.role !== 'admin') return <Navigate to="/browse" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/browse" replace />} />
        <Route path="browse" element={<BrowsePage />} />
        <Route path="cars/:id" element={<CarDetailPage />} />
        <Route path="bookings" element={<MyBookingsPage />} />
        <Route path="verify" element={<VerifyPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="inquire" element={<InquirePage />} />
        <Route path="help" element={<HelpPage />} />

        <Route path="my-vehicles" element={<MyVehiclesPage />} />
        <Route path="my-vehicles/new" element={<AddVehiclePage />} />
        <Route path="my-vehicles/:id/edit" element={<EditVehiclePage />} />
        <Route path="bookings-received" element={<BookingsReceivedPage />} />

        <Route path="admin" element={<RequireStaff><AdminDashboardPage /></RequireStaff>} />
        <Route path="admin/analytics" element={<RequireStaff><AdminAnalyticsPage /></RequireStaff>} />
        <Route path="admin/users" element={<RequireStaff><AdminUsersPage /></RequireStaff>} />
        <Route path="admin/vehicles" element={<RequireStaff><AdminVehiclesPage /></RequireStaff>} />
        <Route path="admin/disputes" element={<RequireStaff><AdminDisputesPage /></RequireStaff>} />
        <Route path="admin/inquiries" element={<RequireStaff><AdminInquiriesPage /></RequireStaff>} />
        <Route path="admin/catalog" element={<RequireFullAdmin><AdminCatalogPage /></RequireFullAdmin>} />
        <Route path="admin/payments" element={<RequireFullAdmin><AdminPaymentsPage /></RequireFullAdmin>} />
        <Route path="admin/audit" element={<RequireFullAdmin><AdminAuditPage /></RequireFullAdmin>} />
        <Route path="admin/settings" element={<RequireFullAdmin><AdminSettingsPage /></RequireFullAdmin>} />
        <Route path="admin/company-info" element={<RequireFullAdmin><AdminCompanyInfoPage /></RequireFullAdmin>} />
      </Route>

      <Route path="*" element={<Navigate to="/browse" replace />} />
    </Routes>
  );
}
