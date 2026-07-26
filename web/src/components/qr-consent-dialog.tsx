import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface QrConsentDialogProps {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

// Deliberately a separate, forced-read step rather than folding this into
// the single blanket consent checkbox at the bottom of the form -- the QR
// code links to a government verification page (sensitive/specific enough
// to warrant its own explicit notice, not a buried checkbox someone can
// tick without reading). The countdown is a real forcing function, not
// just a label -- "I Understand" is genuinely disabled until it elapses.
const READ_SECONDS = 5;

export function QrConsentDialog({ open, onAccept, onCancel }: QrConsentDialogProps) {
  const [secondsLeft, setSecondsLeft] = useState(READ_SECONDS);

  useEffect(() => {
    if (!open) return;
    setSecondsLeft(READ_SECONDS);
    const interval = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm animate-[overlay-in_180ms_ease]" onClick={onCancel}>
      <div
        className="glass w-full max-w-md animate-[modal-in_200ms_cubic-bezier(0.22,1,0.36,1)] rounded-2xl border border-line/70 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-base font-bold">Before you upload your driver's license QR code</h3>
        <div className="mb-4 flex flex-col gap-2 text-sm text-muted">
          <p>
            Your digital driver's license QR code links to a government verification page containing your license
            number. We ask for a screenshot of it specifically to speed up admin review of your identity.
          </p>
          <p>
            <strong className="text-ink">What happens to it:</strong> our server automatically reads the QR code's
            contents and shows the decoded link to the admin reviewing your submission, so they don't need to scan
            it themselves. We do not visit that link automatically, and we don't attempt to access anything beyond
            what's encoded in the QR code itself.
          </p>
          <p>
            <strong className="text-ink">Storage:</strong> this image is stored in the same private, admin-only
            verification storage as your other ID documents — never shown to other users — and kept as part of your
            verification record.
          </p>
          <p>Continuing means you consent to this specific collection, on top of the general consent below.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Never mind
          </Button>
          <Button size="sm" disabled={secondsLeft > 0} onClick={onAccept}>
            {secondsLeft > 0 ? `I Understand (${secondsLeft})` : 'I Understand'}
          </Button>
        </div>
      </div>
    </div>
  );
}
