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
import { InquirePage } from '@/routes/inquire';
import { AdminInquiriesPage } from '@/routes/admin/inquiries';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="p-8 text-muted">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
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

        <Route path="my-vehicles" element={<MyVehiclesPage />} />
        <Route path="my-vehicles/new" element={<AddVehiclePage />} />
        <Route path="my-vehicles/:id/edit" element={<EditVehiclePage />} />
        <Route path="bookings-received" element={<BookingsReceivedPage />} />

        <Route path="admin" element={<RequireAdmin><AdminDashboardPage /></RequireAdmin>} />
        <Route path="admin/users" element={<RequireAdmin><AdminUsersPage /></RequireAdmin>} />
        <Route path="admin/vehicles" element={<RequireAdmin><AdminVehiclesPage /></RequireAdmin>} />
        <Route path="admin/catalog" element={<RequireAdmin><AdminCatalogPage /></RequireAdmin>} />
        <Route path="admin/disputes" element={<RequireAdmin><AdminDisputesPage /></RequireAdmin>} />
        <Route path="admin/inquiries" element={<RequireAdmin><AdminInquiriesPage /></RequireAdmin>} />
        <Route path="admin/payments" element={<RequireAdmin><AdminPaymentsPage /></RequireAdmin>} />
        <Route path="admin/audit" element={<RequireAdmin><AdminAuditPage /></RequireAdmin>} />
        <Route path="admin/settings" element={<RequireAdmin><AdminSettingsPage /></RequireAdmin>} />
      </Route>

      <Route path="*" element={<Navigate to="/browse" replace />} />
    </Routes>
  );
}
