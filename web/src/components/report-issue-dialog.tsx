import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { disputeEvidencePath, uploadFile } from '@/lib/storage';
import { Button } from '@/components/ui/button';

interface ReportIssueDialogProps {
  bookingId: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

export function ReportIssueDialog({ bookingId, onClose, onSubmitted }: ReportIssueDialogProps) {
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);

  const submit = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const paths: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const path = disputeEvidencePath(bookingId!, i, photos[i]);
        await uploadFile('dispute-evidence', path, photos[i]);
        paths.push(path);
      }
      const { error } = await supabase.from('disputes').insert({
        booking_id: bookingId,
        reporter_id: userData.user!.id,
        description,
        photo_paths: paths,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDescription('');
      setPhotos([]);
      onSubmitted();
    },
  });

  if (!bookingId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-bold">Report an Issue</h3>
        <textarea
          className="input-base mb-3 h-24"
          placeholder="Describe what happened…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Photos (optional)</label>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png"
          className="mb-4"
          onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 4))}
        />
        {submit.isError ? <p className="mb-2 text-sm text-bad">{(submit.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Never mind</Button>
          <Button variant="danger" size="sm" disabled={!description || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Submitting…' : 'Submit Report'}
          </Button>
        </div>
      </div>
    </div>
  );
}
