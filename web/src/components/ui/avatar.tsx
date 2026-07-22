import { cn } from '@/lib/utils';
import { publicUrl } from '@/lib/storage';

interface AvatarProps {
  avatarPath?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-16 w-16 text-lg',
} as const;

// The face-only selfie captured during Get Verified becomes this, once
// admin approves the submission — see approve_verification()/027_profile_avatar.sql.
// Falls back to initials so an unverified/pending user still renders sensibly.
export function Avatar({ avatarPath, firstName, lastName, size = 'md', className }: AvatarProps) {
  const url = publicUrl('avatars', avatarPath ?? null);
  const initials = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '·';
  const name = `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Profile photo';

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={cn(SIZE_CLASSES[size], 'shrink-0 rounded-full border border-line/70 object-cover shadow-sm', className)}
      />
    );
  }
  return (
    <div
      className={cn(
        SIZE_CLASSES[size],
        'grid shrink-0 place-items-center rounded-full border border-line/70 bg-accent-soft font-bold text-accent-strong',
        className
      )}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
