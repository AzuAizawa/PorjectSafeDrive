type Severity = 'info' | 'warn' | 'good';

const ICON: Record<Severity, string> = { info: 'ℹ️', warn: '⚠️', good: '✓' };
const CLASS: Record<Severity, string> = {
  info: 'border-info bg-info-soft text-info',
  warn: 'border-warn bg-warn-soft text-warn',
  good: 'border-good bg-good-soft text-good',
};

export function SuggestionCard({ severity, text }: { severity: Severity; text: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${CLASS[severity]}`}>
      <span aria-hidden="true">{ICON[severity]}</span>
      <span className="text-ink">{text}</span>
    </div>
  );
}
