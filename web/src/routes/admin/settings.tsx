import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import type { PlatformSetting } from '@/lib/database.types';

async function fetchSettings() {
  const { data, error } = await supabase.from('platform_settings').select('*').order('key');
  if (error) throw error;
  return data as PlatformSetting[];
}

// Groups mirror how these numbers actually get changed in practice (a
// commission review vs. a booking-timing tweak vs. a security parameter are
// different conversations with different stakeholders) — panel feedback
// asked for a lock "on each section" specifically so one wrong click in,
// say, Payments can't also leave Login Security wide open to a misclick.
const SECTIONS: { title: string; keys: string[] }[] = [
  {
    title: 'Payments & Commission',
    keys: [
      'commission_percent', 'downpayment_percent', 'cancellation_fee_percent',
      'max_deposit_percent', 'subscription_price', 'subscription_slots', 'free_vehicle_slots',
    ],
  },
  {
    title: 'Booking Rules & Timing',
    keys: [
      'free_cancel_hours', 'no_free_cancel_hours_before_pickup', 'no_show_grace_minutes',
      'owner_response_hours', 'payment_deadline_hours', 'auto_complete_grace_days',
      'review_blind_days', 'orcr_expiry_reminder_days',
    ],
  },
  {
    title: 'Trust & Safety',
    keys: ['demerit_strike_threshold', 'strike_decay_months', 'minimum_renter_age', 'max_vehicle_age_years'],
  },
  {
    title: 'Login Security',
    keys: ['email_otp_expiry_minutes', 'email_otp_resend_cooldown_seconds'],
  },
];

function SettingsSection({
  title,
  items,
  edited,
  onEdit,
  relockSignal,
}: {
  title: string;
  items: PlatformSetting[];
  edited: Record<string, string>;
  onEdit: (key: string, value: string) => void;
  relockSignal: number;
}) {
  const [unlocked, setUnlocked] = useState(false);

  // Re-lock automatically after a successful save elsewhere on the page —
  // the whole point of the lock is that it doesn't stay open by accident,
  // including right after you just used it.
  useEffect(() => {
    setUnlocked(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relockSignal]);

  if (items.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          {unlocked ? <LockOpen className="h-3.5 w-3.5 text-muted" strokeWidth={2.25} /> : <Lock className="h-3.5 w-3.5 text-muted" strokeWidth={2.25} />}
          {title}
        </h3>
        <div className="flex items-center gap-2">
          <Label htmlFor={`unlock-${title}`} className="text-xs font-semibold text-muted">
            {unlocked ? 'Unlocked' : 'Locked'}
          </Label>
          <Switch id={`unlock-${title}`} checked={unlocked} onCheckedChange={setUnlocked} />
        </div>
      </div>

      {items.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-5 border-b border-line py-4 last:border-none">
          <div>
            <div className="text-[13.5px] font-semibold">{s.key.replace(/_/g, ' ')}</div>
            <div className="text-xs text-muted">{s.description}</div>
          </div>
          <input
            className="input-base w-28 text-right tabular disabled:cursor-not-allowed disabled:opacity-50"
            defaultValue={edited[s.key] ?? String(s.value)}
            disabled={!unlocked}
            onChange={(e) => onEdit(s.key, e.target.value)}
          />
        </div>
      ))}
    </Card>
  );
}

export function AdminSettingsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['platform-settings'], queryFn: fetchSettings });
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [relockSignal, setRelockSignal] = useState(0);

  const save = useMutation({
    mutationFn: async () => {
      for (const [key, value] of Object.entries(edited)) {
        const { error } = await supabase
          .from('platform_settings')
          .update({ value: Number(value), updated_at: new Date().toISOString(), updated_by: profile!.id })
          .eq('key', key);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setEdited({});
      setRelockSignal((n) => n + 1);
      queryClient.invalidateQueries({ queryKey: ['platform-settings'] });
    },
  });

  const grouped = SECTIONS.map((section) => ({
    title: section.title,
    items: (settings ?? []).filter((s) => section.keys.includes(s.key)),
  }));
  const groupedKeys = new Set(SECTIONS.flatMap((s) => s.keys));
  const leftover = (settings ?? []).filter((s) => !groupedKeys.has(s.key));

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Platform Settings</h1>
        <p className="mt-1.5 text-muted">
          Every business rule lives here — nothing is hardcoded in the app. Each section starts locked; toggle it
          open before editing so a misclick can't change a live business rule.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {grouped.map((g) => (
          <SettingsSection key={g.title} title={g.title} items={g.items} edited={edited} onEdit={(k, v) => setEdited((p) => ({ ...p, [k]: v }))} relockSignal={relockSignal} />
        ))}
        {leftover.length > 0 ? (
          <SettingsSection title="Other" items={leftover} edited={edited} onEdit={(k, v) => setEdited((p) => ({ ...p, [k]: v }))} relockSignal={relockSignal} />
        ) : null}
      </div>

      <div className="mt-4 flex flex-col items-end gap-2">
        <Button disabled={Object.keys(edited).length === 0 || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
        {save.isSuccess ? <p className="text-xs text-good">Saved — takes effect immediately.</p> : null}
        {save.isError ? <p className="text-xs text-bad">{friendlyErrorMessage(save.error)}</p> : null}
      </div>
    </div>
  );
}
