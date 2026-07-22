import { supabase } from '@/lib/supabase';

export async function uploadFile(bucket: string, path: string, file: File) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (error) throw error;
  return path;
}

export function publicUrl(bucket: string, path: string | null) {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function signedUrl(bucket: string, path: string, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

function extOf(file: File) {
  const parts = file.name.split('.');
  return parts.length > 1 ? parts.pop() : 'bin';
}

export function verificationImagePath(userId: string, kind: string, file: File) {
  return `${userId}/${kind}-${Date.now()}.${extOf(file)}`;
}

export function vehicleImagePath(vehicleId: string, index: number, file: File) {
  return `${vehicleId}/${index}-${Date.now()}.${extOf(file)}`;
}

export function vehicleDocPath(vehicleId: string, kind: 'orcr' | 'rental-agreement', file: File) {
  return `${vehicleId}/${kind}/${Date.now()}.${extOf(file)}`;
}
