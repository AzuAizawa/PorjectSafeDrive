import { useState } from 'react';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function validateFile(file: File, allowedTypes: string[], maxSizeBytes = MAX_SIZE_BYTES): string | null {
  if (!allowedTypes.includes(file.type)) {
    return `"${file.name}" isn't an accepted file type.`;
  }
  if (file.size > maxSizeBytes) {
    return `"${file.name}" is too large (max ${Math.round(maxSizeBytes / 1024 / 1024)}MB).`;
  }
  return null;
}

interface FileUploadBoxProps {
  label: string;
  accept: string;
  allowedTypes: string[];
  hint: string;
  file: File | null;
  onSelect: (file: File | null) => void;
  maxSizeBytes?: number;
}

// A visibly clickable upload target — a bare <input type="file"> has no
// affordance beyond browser-default styling, which real user testing
// showed people didn't realize was clickable.
export function FileUploadBox({ label, accept, allowedTypes, hint, file, onSelect, maxSizeBytes }: FileUploadBoxProps) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <label className="block cursor-pointer rounded-xl border-2 border-dashed border-line bg-surface-2/70 p-4 text-center text-xs font-semibold text-muted backdrop-blur-sm hover:border-accent hover:text-accent hover:bg-accent-soft/40 hover:-translate-y-px hover:shadow-[0_8px_20px_-12px_rgba(var(--shadow-tint),0.4)]">
        {file ? `📄 ${file.name}` : `📤 Click to upload — ${hint}`}
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (!f) { onSelect(null); return; }
            const validationError = validateFile(f, allowedTypes, maxSizeBytes);
            if (validationError) {
              setError(validationError);
              onSelect(null);
              e.target.value = '';
              return;
            }
            setError(null);
            onSelect(f);
          }}
        />
      </label>
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : null}
    </div>
  );
}
