import type { Profile } from '@/lib/database.types';

export function roleLabel(role: Profile['role']) {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'admin') return 'Admin';
  if (role === 'support') return 'Support';
  return 'User';
}
