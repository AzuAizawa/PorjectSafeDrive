// LTO private-vehicle registration (the OR/CR) renews annually in the
// Philippines — the warning windows below (60d/0d) just give an owner and
// admin visible lead time before that real deadline, not an invented rule.
export function orcrExpiryStatus(expiryDate: string | null) {
  if (!expiryDate) return { label: 'No expiry date on file', tone: 'muted' as const };

  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000);

  if (days < 0) return { label: `Registration expired ${Math.abs(days)}d ago`, tone: 'bad' as const };
  if (days === 0) return { label: 'Registration expires today', tone: 'bad' as const };
  if (days <= 60) return { label: `Registration expires in ${days}d`, tone: 'warn' as const };
  return { label: `Registration valid until ${expiryDate}`, tone: 'good' as const };
}
