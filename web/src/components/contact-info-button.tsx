import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/avatar';
import { friendlyErrorMessage } from '@/lib/friendly-error';

interface ContactInfoButtonProps {
  bookingId: string;
  avatarPath?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

async function fetchContact(bookingId: string) {
  const { data, error } = await supabase.rpc('get_booking_counterpart_contact', { p_booking_id: bookingId });
  if (error) throw error;
  return data?.[0] as { first_name: string | null; last_name: string | null; phone: string | null } | undefined;
}

// Wraps Avatar with a click-to-reveal popover for the other party's basic
// contact info (name + phone only — see 057_booking_counterpart_contact.sql
// for why address/birthday are deliberately excluded, and why this is
// gated to after the owner accepts).
export function ContactInfoButton({ bookingId, avatarPath, firstName, lastName, size = 'sm' }: ContactInfoButtonProps) {
  const [open, setOpen] = useState(false);
  const { data, error, isLoading } = useQuery({
    queryKey: ['booking-contact', bookingId],
    queryFn: () => fetchContact(bookingId),
    enabled: open,
  });

  return (
    <div className="relative inline-block">
      <button type="button" className="rounded-full outline-none" onClick={() => setOpen((o) => !o)} aria-label="View contact info">
        <Avatar avatarPath={avatarPath} firstName={firstName} lastName={lastName} size={size} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass absolute left-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-line/70 p-3.5 text-left shadow-xl">
            {isLoading ? (
              <p className="text-xs text-muted">Loading…</p>
            ) : error ? (
              <p className="text-xs text-bad">{friendlyErrorMessage(error)}</p>
            ) : (
              <>
                <div className="text-sm font-bold">{data?.first_name} {data?.last_name}</div>
                <div className="mt-1 text-xs text-muted">{data?.phone || 'No phone number on file'}</div>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
