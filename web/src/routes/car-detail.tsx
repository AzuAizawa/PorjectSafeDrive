import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { publicUrl, signedUrl } from '@/lib/storage';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AvailabilityCalendar } from '@/components/availability-calendar';
import { formatCurrency } from '@/lib/utils';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import { cityLabel } from '@/lib/cities';
import type { PlatformSetting, VehicleListing } from '@/lib/database.types';

async function fetchVehicle(id: string): Promise<VehicleListing & { image_urls: string[] }> {
  const { data, error } = await supabase
    .from('vehicles')
    .select(
      `*, model:car_models(*, brand:car_brands(*)), owner:profiles(id, first_name, last_name, avatar_url),
       vehicle_images(storage_path, sort_order)`
    )
    .eq('id', id)
    .single();
  if (error) throw error;
  const images = (data as any).vehicle_images?.sort((a: any, b: any) => a.sort_order - b.sort_order) ?? [];
  // Every uploaded photo (up to 4), not just the cover — previously only the
  // first image was ever surfaced to renters, the rest were silently dropped.
  const imageUrls = images.map((img: any) => publicUrl('car-images', img.storage_path)).filter(Boolean) as string[];
  return { ...(data as any), cover_image_url: imageUrls[0] ?? null, image_urls: imageUrls };
}

async function fetchSettings(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('platform_settings').select('key, value');
  if (error) throw error;
  return Object.fromEntries((data as PlatformSetting[]).map((s) => [s.key, Number(s.value)]));
}

interface VisibleReview {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_first_name: string | null;
  reviewer_last_name: string | null;
}

async function fetchOwnerReviews(ownerId: string) {
  const { data, error } = await supabase.rpc('get_visible_reviews_for_owner', { p_owner_id: ownerId });
  if (error) throw error;
  return data as VisibleReview[];
}

export function CarDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  // Dates picked on Browse's availability filter carry over here so the
  // renter doesn't have to re-pick the same range on this calendar — but
  // only if they're not stale (e.g. an old bookmarked/shared link).
  const todayIso = new Date().toISOString().slice(0, 10);
  const carriedStart = searchParams.get('start');
  const carriedEnd = searchParams.get('end');
  const [startDate, setStartDate] = useState(carriedStart && carriedStart >= todayIso ? carriedStart : '');
  const [endDate, setEndDate] = useState(carriedStart && carriedStart >= todayIso ? (carriedEnd ?? '') : '');
  const [pickupTime, setPickupTime] = useState('10:00');
  const [reportOpen, setReportOpen] = useState(false);
  const [activeImage, setActiveImage] = useState(0);

  const { data: vehicle } = useQuery({ queryKey: ['vehicle', id], queryFn: () => fetchVehicle(id!), enabled: !!id });
  const { data: settings } = useQuery({ queryKey: ['platform_settings'], queryFn: fetchSettings });
  const { data: rentalAgreementUrl } = useQuery({
    queryKey: ['rental-agreement', vehicle?.rental_agreement_path],
    queryFn: () => signedUrl('vehicle-documents', vehicle!.rental_agreement_path!),
    enabled: !!vehicle?.rental_agreement_path,
  });
  const { data: reviews } = useQuery({
    queryKey: ['owner-reviews', vehicle?.owner.id],
    queryFn: () => fetchOwnerReviews(vehicle!.owner.id),
    enabled: !!vehicle?.owner.id,
  });
  const averageRating = reviews && reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

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

  const reportListing = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase
        .from('listing_reports')
        .insert({ vehicle_id: id, reporter_id: profile!.id, reason });
      if (error) throw error;
    },
    onSuccess: () => setReportOpen(false),
  });

  const requestBooking = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('request_booking', {
        p_vehicle_id: id,
        p_start_date: startDate,
        p_end_date: endDate,
        p_pickup_time: pickupTime,
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
            {vehicle.image_urls[activeImage] ? (
              <img
                src={vehicle.image_urls[activeImage]}
                alt={vehicle.model.name}
                className="h-full w-full rounded-2xl object-cover"
              />
            ) : null}
          </div>
          {vehicle.image_urls.length > 1 ? (
            <div className="mt-2 flex gap-2">
              {vehicle.image_urls.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setActiveImage(i)}
                  className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${
                    i === activeImage ? 'border-accent' : 'border-transparent'
                  }`}
                >
                  <img src={url} alt={`${vehicle.model.name} photo ${i + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-5 flex items-start justify-between">
            <div>
              <h1 className="text-2xl">
                {vehicle.model.brand.name} {vehicle.model.name}
              </h1>
              <div className="mt-2 flex items-center gap-2.5">
                <Avatar avatarPath={vehicle.owner.avatar_url} firstName={vehicle.owner.first_name} lastName={vehicle.owner.last_name} size="sm" />
                <p className="text-muted">
                  Listed by <strong>{vehicle.owner.first_name} {vehicle.owner.last_name}</strong>
                  {averageRating !== null ? (
                    <> · <span className="font-semibold text-warn">★ {averageRating.toFixed(1)}</span> ({reviews!.length})</>
                  ) : null}
                </p>
              </div>
            </div>
            <button className="text-xs font-semibold text-muted underline hover:text-bad" onClick={() => setReportOpen(true)}>
              Report this listing
            </button>
          </div>

          <Card className="mt-4.5 p-5">
            <h3 className="mb-1 text-sm font-bold">Vehicle specs</h3>
            {[
              ['Body type', vehicle.model.body_type],
              ['Seats', vehicle.model.seats],
              ['Fuel type', vehicle.model.fuel_type],
              ['Transmission', vehicle.transmission === 'automatic' ? 'Automatic' : 'Manual'],
              ...(vehicle.model_year ? [['Model year', vehicle.model_year]] : []),
              ['City', cityLabel(vehicle.city)],
              ['Pickup / drop-off', vehicle.pickup_location],
              ...(vehicle.requires_deposit
                ? [['Refundable security deposit', formatCurrency(vehicle.deposit_amount ?? 0)]]
                : []),
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

          {settings ? (
            <Card className="mt-3.5 p-5">
              <h3 className="mb-2 text-sm font-bold">Booking policies</h3>
              <ul className="flex flex-col gap-2 text-[13px] text-muted">
                <li>
                  You must be at least <strong className="text-ink">{settings.minimum_renter_age}</strong> years old and
                  verified to book.
                </li>
                <li>
                  Free cancellation for <strong className="text-ink">{settings.free_cancel_hours}h</strong> after paying,
                  as long as it's more than <strong className="text-ink">{settings.no_free_cancel_hours_before_pickup}h</strong>{' '}
                  before pickup. After that, a <strong className="text-ink">{settings.cancellation_fee_percent}%</strong> fee
                  applies.
                </li>
                <li>
                  Show up within <strong className="text-ink">{settings.no_show_grace_minutes} minutes</strong> of your
                  chosen pickup time — after that, the owner may cancel the booking with a cancellation fee and a strike
                  on your account.
                </li>
              </ul>
            </Card>
          ) : null}

          {vehicle.rental_agreement_path ? (
            <Card className="mt-3.5 flex items-center justify-between p-5">
              <div>
                <h3 className="text-sm font-bold">Rental agreement</h3>
                <p className="mt-0.5 text-xs text-muted">Standard SafeDrive rental terms, uploaded by the owner.</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={!rentalAgreementUrl}
                onClick={() => rentalAgreementUrl && window.open(rentalAgreementUrl, '_blank')}
              >
                ⬇ Download
              </Button>
            </Card>
          ) : null}

          {reviews && reviews.length > 0 ? (
            <Card className="mt-3.5 p-5">
              <h3 className="mb-3 text-sm font-bold">Reviews ({reviews.length})</h3>
              <div className="flex flex-col gap-3.5">
                {reviews.map((r) => (
                  <div key={r.id} className="border-b border-line pb-3.5 last:border-none last:pb-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold">{r.reviewer_first_name} {r.reviewer_last_name}</span>
                      <span className="text-xs font-semibold text-warn">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                    </div>
                    {r.comment ? <p className="mt-1 text-sm text-muted">{r.comment}</p> : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <Card className="sticky top-[76px] p-5">
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Pick your dates</label>
          <AvailabilityCalendar
            vehicleId={id!}
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
          />

          {startDate ? (
            <p className="mt-2 text-xs text-muted">
              {endDate ? `${startDate} → ${endDate}` : `${startDate} — now pick your return date`}
            </p>
          ) : null}

          <label className="mb-1.5 mt-3.5 block text-xs font-bold uppercase tracking-wide text-muted">Pickup time</label>
          <input
            type="time"
            className="mb-4 h-[38px] w-full rounded-md border border-line bg-surface px-3"
            value={pickupTime}
            onChange={(e) => setPickupTime(e.target.value)}
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
              {vehicle.requires_deposit ? (
                <div className="flex justify-between py-2 text-[13.5px] text-muted">
                  <span>Security deposit (refundable, paid with downpayment)</span>
                  <span className="tabular">{formatCurrency(vehicle.deposit_amount ?? 0)}</span>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">Pick your dates to see pricing.</p>
          )}

          {profile && profile.verified_status !== 'verified' ? (
            <>
              <Button block className="mt-3.5" onClick={() => navigate('/verify')}>Get Verified to Book</Button>
              <p className="mt-2 text-center text-xs text-muted">You need to be a verified user before you can book a vehicle.</p>
            </>
          ) : (
            <>
              <Button
                block
                className="mt-3.5"
                disabled={!pricing || requestBooking.isPending}
                onClick={() => requestBooking.mutate()}
              >
                {requestBooking.isPending ? 'Sending request…' : 'Request to Book'}
              </Button>
              {requestBooking.isError ? (
                <p className="mt-2 text-center text-xs text-bad">{friendlyErrorMessage(requestBooking.error)}</p>
              ) : (
                <p className="mt-2 text-center text-xs text-muted">You won't be charged until the owner accepts.</p>
              )}
            </>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={reportOpen}
        title="Report this listing"
        description="Tell us what looks wrong — fake photos, misleading info, etc. Admin will re-review the listing."
        requireReason
        reasonPlaceholder="What's the issue?"
        confirmLabel="Submit Report"
        confirmVariant="danger"
        pending={reportListing.isPending}
        onConfirm={(reason) => reason && reportListing.mutate(reason)}
        onCancel={() => setReportOpen(false)}
        error={reportListing.isError ? friendlyErrorMessage(reportListing.error) : null}
      />
    </div>
  );
}
