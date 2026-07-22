import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  requireReason?: boolean;
  reasonPlaceholder?: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  pending?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  requireReason = false,
  reasonPlaceholder = 'Reason…',
  onConfirm,
  onCancel,
  pending = false,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-base font-bold">{title}</h3>
        {description ? <div className="mb-4 text-sm text-muted">{description}</div> : null}
        {requireReason ? (
          <input
            className="input-base mb-4"
            placeholder={reasonPlaceholder}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Never mind
          </Button>
          <Button
            variant={confirmVariant}
            size="sm"
            disabled={pending || (requireReason && !reason)}
            onClick={() => onConfirm(requireReason ? reason : undefined)}
          >
            {pending ? 'Please wait…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Hook that tracks which row (by id) a confirm dialog is currently open for,
// so a list of bookings/vehicles can share one dialog instance.
export function useConfirmTarget<T extends string>() {
  const [target, setTarget] = useState<T | null>(null);
  return { target, open: (id: T) => setTarget(id), close: () => setTarget(null) };
}
