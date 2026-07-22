import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/AppShell';
import { ComingSoon } from '@/components/layout/ComingSoon';
import { LoginPage } from '@/routes/login';
import { BrowsePage } from '@/routes/browse';
import { CarDetailPage } from '@/routes/car-detail';
import { MyBookingsPage } from '@/routes/my-bookings';
import { VerifyPage } from '@/routes/verify';
import { MyVehiclesPage } from '@/routes/my-vehicles';
import { AddVehiclePage } from '@/routes/add-vehicle';
import { BookingsReceivedPage } from '@/routes/bookings-received';
import { AdminUsersPage } from '@/routes/admin/users';
import { AdminVehiclesPage } from '@/routes/admin/vehicles';

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

        <Route path="my-vehicles" element={<MyVehiclesPage />} />
        <Route path="my-vehicles/new" element={<AddVehiclePage />} />
        <Route path="bookings-received" element={<BookingsReceivedPage />} />

        <Route
          path="admin"
          element={
            <RequireAdmin>
              <ComingSoon eyebrow="Admin" title="Dashboard" />
            </RequireAdmin>
          }
        />
        <Route path="admin/users" element={<RequireAdmin><AdminUsersPage /></RequireAdmin>} />
        <Route path="admin/vehicles" element={<RequireAdmin><AdminVehiclesPage /></RequireAdmin>} />
        <Route path="admin/catalog" element={<RequireAdmin><ComingSoon eyebrow="Admin" title="Car Catalog" /></RequireAdmin>} />
        <Route path="admin/disputes" element={<RequireAdmin><ComingSoon eyebrow="Admin" title="Disputes" /></RequireAdmin>} />
        <Route path="admin/payments" element={<RequireAdmin><ComingSoon eyebrow="Admin" title="Send Payments" /></RequireAdmin>} />
        <Route path="admin/audit" element={<RequireAdmin><ComingSoon eyebrow="Admin" title="Audit Trail" /></RequireAdmin>} />
        <Route path="admin/settings" element={<RequireAdmin><ComingSoon eyebrow="Admin" title="Platform Settings" /></RequireAdmin>} />
      </Route>

      <Route path="*" element={<Navigate to="/browse" replace />} />
    </Routes>
  );
}
