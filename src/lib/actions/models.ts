'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { uploadFile } from '@/lib/supabase/storage';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

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
    throw new Error(parsed.error.issues.map((i) => i.message).join(', '));
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
    throw new Error(error.message);
  }

  revalidatePath('/models');
  redirect(`/models/${data.id}`);
}

const updateBrandKitSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().min(1).max(100),
  tone_notes: z.string().max(2000).optional(),
  default_style_prompt: z.string().max(2000).optional(),
  watermark_position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']),
  brand_color_primary: z.string().optional(),
  brand_color_secondary: z.string().optional(),
  brand_color_accent: z.string().optional(),
  font_heading: z.string().optional(),
  font_body: z.string().optional(),
  font_notes: z.string().optional(),
  banned_words: z.string().optional(),  // comma-separated input
  banned_themes: z.string().optional(),
});

export async function updateBrandKit(formData: FormData) {
  const parsed = updateBrandKitSchema.safeParse({
    id: formData.get('id'),
    display_name: formData.get('display_name'),
    tone_notes: formData.get('tone_notes') || undefined,
    default_style_prompt: formData.get('default_style_prompt') || undefined,
    watermark_position: formData.get('watermark_position'),
    brand_color_primary: formData.get('brand_color_primary') || undefined,
    brand_color_secondary: formData.get('brand_color_secondary') || undefined,
    brand_color_accent: formData.get('brand_color_accent') || undefined,
    font_heading: formData.get('font_heading') || undefined,
    font_body: formData.get('font_body') || undefined,
    font_notes: formData.get('font_notes') || undefined,
    banned_words: formData.get('banned_words') || undefined,
    banned_themes: formData.get('banned_themes') || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(', '));
  }

  const d = parsed.data;

  // Handle file uploads
  const logoFile = formData.get('logo_file') as File | null;
  const watermarkFile = formData.get('watermark_file') as File | null;

  const updates: Record<string, unknown> = {
    display_name: d.display_name,
    tone_notes: d.tone_notes || null,
    default_style_prompt: d.default_style_prompt || null,
    watermark_position: d.watermark_position,
    brand_colors: {
      primary: d.brand_color_primary || null,
      secondary: d.brand_color_secondary || null,
      accent: d.brand_color_accent || null,
    },
    font_preferences: {
      heading: d.font_heading || null,
      body: d.font_body || null,
      notes: d.font_notes || null,
    },
    banned_words: d.banned_words
      ? d.banned_words.split(',').map((w) => w.trim()).filter(Boolean)
      : [],
    banned_themes: d.banned_themes
      ? d.banned_themes.split(',').map((w) => w.trim()).filter(Boolean)
      : [],
  };

  if (logoFile && logoFile.size > 0) {
    const path = `models/${d.id}/logo-${Date.now()}-${logoFile.name}`;
    const result = await uploadFile(path, logoFile, logoFile.type);
    if ('error' in result) throw new Error(`Logo upload failed: ${result.error}`);
    updates.logo_url = result.url;
  }

  if (watermarkFile && watermarkFile.size > 0) {
    const path = `models/${d.id}/watermark-${Date.now()}-${watermarkFile.name}`;
    const result = await uploadFile(path, watermarkFile, watermarkFile.type);
    if ('error' in result) throw new Error(`Watermark upload failed: ${result.error}`);
    updates.watermark_url = result.url;
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('models').update(updates).eq('id', d.id);

  if (error) {
    console.error('[updateBrandKit] Supabase error:', error);
    throw new Error(error.message);
  }

  revalidatePath(`/models/${d.id}`);
  redirect(`/models/${d.id}`);
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
  const { data, error } = await supabase.from('models').select('*').eq('id', id).single();
  if (error) {
    console.error('[getModel] Supabase error:', error);
    return null;
  }
  return data;
}
