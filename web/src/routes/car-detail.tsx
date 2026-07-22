import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { publicUrl } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import type { PlatformSetting, VehicleListing } from '@/lib/database.types';

async function fetchVehicle(id: string): Promise<VehicleListing> {
  const { data, error } = await supabase
    .from('vehicles')
    .select(
      `*, model:car_models(*, brand:car_brands(*)), owner:profiles(id, first_name, last_name),
       vehicle_images(storage_path, sort_order)`
    )
    .eq('id', id)
    .single();
  if (error) throw error;
  const images = (data as any).vehicle_images?.sort((a: any, b: any) => a.sort_order - b.sort_order) ?? [];
  return { ...(data as any), cover_image_url: publicUrl('car-images', images[0]?.storage_path ?? null) };
}

async function fetchSettings(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('platform_settings').select('key, value');
  if (error) throw error;
  return Object.fromEntries((data as PlatformSetting[]).map((s) => [s.key, Number(s.value)]));
}

export function CarDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { data: vehicle } = useQuery({ queryKey: ['vehicle', id], queryFn: () => fetchVehicle(id!), enabled: !!id });
  const { data: settings } = useQuery({ queryKey: ['platform_settings'], queryFn: fetchSettings });

  const pricing = useMemo(() => {
    if (!vehicle || !settings || !startDate || !endDate) return null;
    const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000);
    if (days <= 0) return null;
    const base = vehicle.daily_price * days;
    const commission = vehicle.daily_price * (settings.commission_percent / 100) * days;
    const total = base + commission;
    const downpayment = total * (settings.downpayment_percent / 100);
    return { days, base, commission, total, downpayment, balance: total - downpayment };
  }, [vehicle, settings, startDate, endDate]);

  const requestBooking = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('request_booking', {
        p_vehicle_id: id,
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      navigate('/bookings');
    },
  });

  if (!vehicle) return <p className="text-muted">Loading…</p>;

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-3.5" onClick={() => navigate('/browse')}>
        ← Back to Browse
      </Button>

      <div className="grid grid-cols-[1.6fr_1fr] items-start gap-6 max-[860px]:grid-cols-1">
        <div>
          <div className="h-80 rounded-2xl bg-surface-2">
            {vehicle.cover_image_url ? (
              <img src={vehicle.cover_image_url} alt={vehicle.model.name} className="h-full w-full rounded-2xl object-cover" />
            ) : null}
          </div>

          <div className="mt-5">
            <h1 className="text-2xl">
              {vehicle.model.brand.name} {vehicle.model.name}
            </h1>
            <p className="mt-1.5 text-muted">
              Listed by <strong>{vehicle.owner.first_name} {vehicle.owner.last_name}</strong>
            </p>
          </div>

          <Card className="mt-4.5 p-5">
            <h3 className="mb-1 text-sm font-bold">Vehicle specs</h3>
            {[
              ['Body type', vehicle.model.body_type],
              ['Seats', vehicle.model.seats],
              ['Fuel type', vehicle.model.fuel_type],
              ['Mileage', `${vehicle.mileage.toLocaleString()} km`],
              ['Pickup / drop-off', vehicle.pickup_location],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between border-b border-line py-2.5 text-[13.5px] last:border-none">
                <span className="text-muted">{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </Card>

          {vehicle.additional_info ? (
            <Card className="mt-3.5 p-5">
              <h3 className="mb-2 text-sm font-bold">From the owner</h3>
              <p className="text-muted">{vehicle.additional_info}</p>
            </Card>
          ) : null}
        </div>

        <Card className="sticky top-[76px] p-5">
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Start date</label>
          <input
            type="date"
            className="mb-3 h-[38px] w-full rounded-md border border-line bg-surface px-3"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">End date</label>
          <input
            type="date"
            className="mb-4 h-[38px] w-full rounded-md border border-line bg-surface px-3"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />

          {pricing ? (
            <>
              <div className="flex justify-between py-2 text-[13.5px]">
                <span>
                  {formatCurrency(vehicle.daily_price)} × {pricing.days} days
                </span>
                <span className="tabular">{formatCurrency(pricing.base)}</span>
              </div>
              <div className="flex justify-between py-2 text-[13.5px]">
                <span>Service &amp; protection fee</span>
                <span className="tabular">{formatCurrency(pricing.commission)}</span>
              </div>
              <div className="mt-1.5 flex justify-between border-t border-line pt-3 text-[15px] font-bold">
                <span>Total price</span>
                <span className="tabular">{formatCurrency(pricing.total)}</span>
              </div>
              <div className="flex justify-between py-2 text-[13.5px] text-muted">
                <span>Downpayment due now</span>
                <span className="tabular">{formatCurrency(pricing.downpayment)}</span>
              </div>
              <div className="flex justify-between py-2 text-[13.5px] text-muted">
                <span>Balance due before pickup</span>
                <span className="tabular">{formatCurrency(pricing.balance)}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Pick your dates to see pricing.</p>
          )}

          <Button
            block
            className="mt-3.5"
            disabled={!pricing || requestBooking.isPending}
            onClick={() => requestBooking.mutate()}
          >
            {requestBooking.isPending ? 'Sending request…' : 'Request to Book'}
          </Button>
          {requestBooking.isError ? (
            <p className="mt-2 text-center text-xs text-bad">{(requestBooking.error as Error).message}</p>
          ) : (
            <p className="mt-2 text-center text-xs text-muted">You won't be charged until the owner accepts.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
