'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const CLIPS_BUCKET = 'clips';

/**
 * Create a signed upload URL for direct browser upload to Supabase Storage.
 * Returns the signed URL and the final storage path.
 */
export async function createClipUploadUrl(filename: string, modelId: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${modelId}/${Date.now()}-${safeName}`;

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(CLIPS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error) {
    console.error('[createClipUploadUrl] error:', error);
    return { error: error.message };
  }

  return { signedUrl: data.signedUrl, token: data.token, path: storagePath };
}

const finalizeSchema = z.object({
  model_id: z.string().uuid(),
  storage_path: z.string().min(1),
  original_filename: z.string().min(1).max(500),
  file_size_bytes: z.number().int().positive(),
});

/**
 * After direct upload succeeds, create the clip row and kick off the Inngest job.
 */
export async function finalizeClipUpload(input: {
  model_id: string;
  storage_path: string;
  original_filename: string;
  file_size_bytes: number;
}) {
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('clips')
    .insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      model_id: parsed.data.model_id,
      source_url: parsed.data.storage_path,
      original_filename: parsed.data.original_filename,
      file_size_bytes: parsed.data.file_size_bytes,
      status: 'uploaded',
    })
    .select()
    .single();

  if (error) {
    console.error('[finalizeClipUpload] insert error:', error);
    return { error: error.message };
  }

  // Kick off the Inngest job
  await inngest.send({
    name: 'clip/uploaded',
    data: { clipId: data.id },
  });

  revalidatePath('/clips');
  return { success: true, clipId: data.id };
}

export async function listClips() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('clips')
    .select('*, models(display_name)')
    .eq('workspace_id', DEFAULT_WORKSPACE_ID)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[listClips] error:', error);
    return [];
  }
  return data;
}

export async function getClip(id: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('clips')
    .select('*, models(display_name)')
    .eq('id', id)
    .single();

  if (error) {
    console.error('[getClip] error:', error);
    return null;
  }
  return data;
}
