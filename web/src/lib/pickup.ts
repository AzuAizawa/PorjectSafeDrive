import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Asia/Manila is a fixed UTC+8 offset, no DST — safe to hardcode, and matches
// the `at time zone 'Asia/Manila'` cast used server-side in cancel_no_show()/
// report_owner_no_show() (037_pickup_time_meetup_and_calendar.sql).
export function pickupTimestamp(startDate: string, pickupTime: string): number {
  return new Date(`${startDate}T${pickupTime}+08:00`).getTime();
}

export function formatTime(pickupTime: string): string {
  const [h, m] = pickupTime.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

export function useNoShowGraceMinutes() {
  return useQuery({
    queryKey: ['platform-setting', 'no_show_grace_minutes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('platform_settings').select('value').eq('key', 'no_show_grace_minutes').single();
      if (error) throw error;
      return Number(data.value);
    },
  });
}
