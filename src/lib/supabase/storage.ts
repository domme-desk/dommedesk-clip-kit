import { createAdminClient } from './admin';

const BUCKET = 'assets';

/**
 * Upload a file to Supabase Storage.
 * Returns the public URL of the uploaded file.
 */
export async function uploadFile(
  path: string,
  file: File | Buffer,
  contentType?: string
): Promise<{ url: string; path: string } | { error: string }> {
  const supabase = createAdminClient();

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType,
    upsert: true,
  });

  if (error) {
    console.error('[uploadFile] Supabase error:', error);
    return { error: error.message };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Delete a file from Supabase Storage.
 */
export async function deleteFile(path: string): Promise<{ error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    console.error('[deleteFile] Supabase error:', error);
    return { error: error.message };
  }
  return {};
}
