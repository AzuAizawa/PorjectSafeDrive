import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

interface RateBookingDialogProps {
  target: { bookingId: string; revieweeId: string } | null;
  onClose: () => void;
  onSubmitted: () => void;
}

export function RateBookingDialog({ target, onClose, onSubmitted }: RateBookingDialogProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const submit = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from('reviews').insert({
        booking_id: target!.bookingId,
        reviewer_id: userData.user!.id,
        reviewee_id: target!.revieweeId,
        rating,
        comment: comment || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setRating(0);
      setComment('');
      onSubmitted();
    },
  });

  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-bold">Rate this rental</h3>
        <div className="mb-3 flex gap-1 text-2xl">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={n <= rating ? 'text-warn' : 'text-line'}
              onClick={() => setRating(n)}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
            >
              ★
            </button>
          ))}
        </div>
        <textarea
          className="input-base mb-4 h-20"
          placeholder="Optional comment…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        {submit.isError ? <p className="mb-2 text-sm text-bad">{(submit.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Never mind</Button>
          <Button size="sm" disabled={rating === 0 || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Submitting…' : 'Submit Rating'}
          </Button>
        </div>
      </div>
    </div>
  );
}
