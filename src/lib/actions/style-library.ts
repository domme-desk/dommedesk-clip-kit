'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { uploadFile } from '@/lib/supabase/storage';
import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Auto-tag a thumbnail image using Claude vision.
 * Returns structured tags describing composition, tone, color, etc.
 */
async function autoTagThumbnail(
  imageUrl: string
): Promise<Record<string, unknown>> {
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: imageUrl },
            },
            {
              type: 'text',
              text: `Analyze this thumbnail for a creator clip. Return ONLY valid JSON (no prose, no markdown fences) with these fields:

{
  "composition": "brief description of layout (e.g., 'subject centered, text top-left')",
  "text_treatment": "description of text style (font weight, color, effects, placement)",
  "color_palette": ["#hex1", "#hex2", "#hex3"],
  "mood": "one or two words (e.g., 'dominant, sultry' or 'playful, bright')",
  "background_type": "real_scene | replaced_thematic | gradient | solid | other",
  "background_description": "what the background shows",
  "subject_pose": "brief description of how the subject is posed",
  "tags": ["short", "descriptive", "tags"]
}`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return {};

    // Strip any accidental markdown fences
    const raw = textBlock.text.trim().replace(/^```json\s*|\s*```$/g, '');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[autoTagThumbnail] error:', err);
    return {};
  }
}

const uploadSchema = z.object({
  model_id: z.string().uuid(),
  asset_type: z.enum(['thumbnail', 'preview', 'caption']),
  notes: z.string().max(1000).optional(),
});

export async function uploadStyleLibraryItem(formData: FormData) {
  const parsed = uploadSchema.safeParse({
    model_id: formData.get('model_id'),
    asset_type: formData.get('asset_type') || 'thumbnail',
    notes: formData.get('notes') || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const files = formData.getAll('files') as File[];
  if (files.length === 0 || files.every((f) => f.size === 0)) {
    return { error: 'No files provided' };
  }

  const supabase = createAdminClient();
  const uploaded: string[] = [];
  const failed: string[] = [];

  for (const file of files) {
    if (file.size === 0) continue;

    const path = `style-library/${parsed.data.model_id}/${Date.now()}-${file.name}`;
    const uploadResult = await uploadFile(path, file, file.type);

    if ('error' in uploadResult) {
      failed.push(`${file.name}: ${uploadResult.error}`);
      continue;
    }

    // Auto-tag via Claude (only for thumbnails for now)
    const autoTags =
      parsed.data.asset_type === 'thumbnail'
        ? await autoTagThumbnail(uploadResult.url)
        : {};

    const { error: insertError } = await supabase.from('style_library_items').insert({
      model_id: parsed.data.model_id,
      scope: 'model',
      asset_type: parsed.data.asset_type,
      asset_url: uploadResult.url,
      auto_tags: autoTags,
      notes: parsed.data.notes || null,
    });

    if (insertError) {
      failed.push(`${file.name}: ${insertError.message}`);
    } else {
      uploaded.push(file.name);
    }
  }

  revalidatePath(`/models/${parsed.data.model_id}/library`);

  return {
    uploaded: uploaded.length,
    failed: failed.length,
    errors: failed,
  };
}

export async function listStyleLibraryItems(modelId: string, assetType?: string) {
  const supabase = createAdminClient();
  let query = supabase
    .from('style_library_items')
    .select('*')
    .eq('model_id', modelId)
    .eq('scope', 'model')
    .order('created_at', { ascending: false });

  if (assetType) {
    query = query.eq('asset_type', assetType);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[listStyleLibraryItems] Supabase error:', error);
    return [];
  }
  return data;
}

export async function deleteStyleLibraryItem(id: string, modelId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase.from('style_library_items').delete().eq('id', id);
  if (error) {
    console.error('[deleteStyleLibraryItem] Supabase error:', error);
    return { error: error.message };
  }
  revalidatePath(`/models/${modelId}/library`);
  return { success: true };
}
