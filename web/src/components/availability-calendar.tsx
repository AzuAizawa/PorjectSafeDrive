import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type DayStatus = 'available' | 'booked' | 'blocked';

interface AvailabilityCalendarProps {
  vehicleId: string;
  startDate: string;
  endDate: string;
  onChange: (startDate: string, endDate: string) => void;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function toIso(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}

async function fetchCalendar(vehicleId: string, from: string, to: string): Promise<Map<string, DayStatus>> {
  const { data, error } = await supabase.rpc('get_vehicle_calendar', { p_vehicle_id: vehicleId, p_from: from, p_to: to });
  if (error) throw error;
  return new Map((data as { day: string; status: DayStatus }[]).map((r) => [r.day, r.status]));
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// A self-contained month-grid calendar (no date library — this is the only
// place in the app that needs one, so a dependency wasn't worth adding).
// Green = available, dark = booked, amber = blocked by the owner — the
// same 3-state legend renters expect from Airbnb/Turo-style calendars.
export function AvailabilityCalendar({ vehicleId, startDate, endDate, onChange }: AvailabilityCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const monthStart = toIso(viewYear, viewMonth, 1);
  const monthEnd = toIso(viewYear, viewMonth, daysInMonth(viewYear, viewMonth));
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

  const { data: statusByDay } = useQuery({
    queryKey: ['vehicle-calendar', vehicleId, monthStart, monthEnd],
    queryFn: () => fetchCalendar(vehicleId, monthStart, monthEnd),
    enabled: !!vehicleId,
  });

  const cells = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const total = daysInMonth(viewYear, viewMonth);
    const out: (string | null)[] = Array(firstWeekday).fill(null);
    for (let d = 1; d <= total; d++) out.push(toIso(viewYear, viewMonth, d));
    return out;
  }, [viewYear, viewMonth]);

  function changeMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewYear(y);
    setViewMonth(m);
  }

  function rangeIsClear(a: string, b: string) {
    if (!statusByDay) return false;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    for (const [day, status] of statusByDay) {
      if (day >= lo && day <= hi && status !== 'available') return false;
    }
    return true;
  }

  function handleClick(day: string) {
    const status = statusByDay?.get(day) ?? 'available';
    if (status !== 'available' || day < todayIso) return;

    if (!startDate || (startDate && endDate)) {
      onChange(day, '');
      return;
    }
    if (day <= startDate) {
      onChange(day, '');
      return;
    }
    if (!rangeIsClear(startDate, day)) {
      onChange(day, '');
      return;
    }
    onChange(startDate, day);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="rounded-md px-2 py-1 text-sm font-bold text-muted hover:bg-surface-2" onClick={() => changeMonth(-1)}>
          ←
        </button>
        <span className="text-sm font-bold">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button type="button" className="rounded-md px-2 py-1 text-sm font-bold text-muted hover:bg-surface-2" onClick={() => changeMonth(1)}>
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold uppercase text-muted">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const status = statusByDay?.get(day) ?? 'available';
          const isPast = day < todayIso;
          const inRange = startDate && endDate && day >= startDate && day <= endDate;
          const isEndpoint = day === startDate || day === endDate;
          const disabled = status !== 'available' || isPast;

          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => handleClick(day)}
              title={status === 'booked' ? 'Already booked' : status === 'blocked' ? 'Blocked by owner' : undefined}
              className={cn(
                'h-8 rounded-md text-[12px] font-semibold transition-colors',
                disabled && status === 'booked' && 'bg-ink text-paper cursor-not-allowed opacity-70',
                disabled && status === 'blocked' && 'bg-warn-soft text-warn cursor-not-allowed',
                disabled && isPast && status === 'available' && 'text-muted-2 cursor-not-allowed opacity-40',
                !disabled && !inRange && 'bg-good-soft text-good hover:brightness-95',
                !disabled && inRange && !isEndpoint && 'bg-accent-soft text-accent',
                !disabled && isEndpoint && 'bg-accent text-white'
              )}
            >
              {Number(day.slice(8, 10))}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-good" /> Available</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink" /> Booked</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-warn" /> Blocked by owner</span>
      </div>
    </div>
  );
}
