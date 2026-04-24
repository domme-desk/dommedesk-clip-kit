'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const exampleSchema = z.object({
  model_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  tags: z.array(z.string()).max(30).default([]),
});

export async function addDescriptionExample(input: {
  model_id: string;
  title: string;
  description: string;
  tags?: string[];
}) {
  const parsed = exampleSchema.safeParse({
    ...input,
    tags: input.tags || [],
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('style_library_items').insert({
    model_id: parsed.data.model_id,
    scope: 'model',
    asset_type: 'caption',
    asset_url: '',
    caption_text: parsed.data.description,
    manual_tags: parsed.data.tags,
    auto_tags: { title: parsed.data.title },
    notes: parsed.data.title,
  });

  if (error) {
    console.error('[addDescriptionExample] error:', error);
    return { error: error.message };
  }

  revalidatePath(`/models/${parsed.data.model_id}/descriptions`);
  return { success: true };
}

/**
 * Bulk add multiple title+description pairs at once.
 * Returns counts of successes and failures.
 */
export async function bulkAddDescriptionExamples(
  modelId: string,
  pairs: Array<{ title: string; description: string; tags?: string[] }>
) {
  let added = 0;
  const errors: string[] = [];
  for (const p of pairs) {
    const res = await addDescriptionExample({
      model_id: modelId,
      title: p.title,
      description: p.description,
      tags: p.tags,
    });
    if (res.success) added += 1;
    else errors.push(`${p.title.slice(0, 40)}: ${res.error}`);
  }
  revalidatePath(`/models/${modelId}/descriptions`);
  return { added, errors };
}

export async function listDescriptionExamples(modelId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('style_library_items')
    .select('*')
    .eq('model_id', modelId)
    .eq('scope', 'model')
    .eq('asset_type', 'caption')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data;
}

export async function deleteDescriptionExample(id: string, modelId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase.from('style_library_items').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath(`/models/${modelId}/descriptions`);
  return { success: true };
}
