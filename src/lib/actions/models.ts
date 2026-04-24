'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

// Hardcoded workspace ID for now (matches the seed row in the migration)
const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

const createModelSchema = z.object({
  display_name: z.string().min(1, 'Display name is required').max(100),
  tone_notes: z.string().max(2000).optional(),
  default_style_prompt: z.string().max(2000).optional(),
  watermark_position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']),
});

export async function createModel(formData: FormData) {
  const parsed = createModelSchema.safeParse({
    display_name: formData.get('display_name'),
    tone_notes: formData.get('tone_notes') || undefined,
    default_style_prompt: formData.get('default_style_prompt') || undefined,
    watermark_position: formData.get('watermark_position') || 'bottom-right',
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => i.message).join(', '),
    };
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('models')
    .insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      display_name: parsed.data.display_name,
      tone_notes: parsed.data.tone_notes || null,
      default_style_prompt: parsed.data.default_style_prompt || null,
      watermark_position: parsed.data.watermark_position,
    })
    .select()
    .single();

  if (error) {
    console.error('[createModel] Supabase error:', error);
    return { error: error.message };
  }

  revalidatePath('/models');
  redirect(`/models/${data.id}`);
}

export async function listModels() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .eq('workspace_id', DEFAULT_WORKSPACE_ID)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[listModels] Supabase error:', error);
    return [];
  }
  return data;
}

export async function getModel(id: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('[getModel] Supabase error:', error);
    return null;
  }
  return data;
}
