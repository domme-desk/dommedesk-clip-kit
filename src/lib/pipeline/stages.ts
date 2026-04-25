import { createAdminClient } from '@/lib/supabase/admin';

export type StageName =
  | 'frame_extraction'
  | 'auto_description'
  | 'frame_scoring'
  | 'template_selection'
  | 'subject_cutouts';

export async function markStageRunning(clipId: string, stage: StageName, input?: Record<string, unknown>) {
  const supabase = createAdminClient();
  await supabase.from('clip_pipeline_stages').upsert(
    {
      clip_id: clipId,
      stage,
      status: 'running',
      input: input || {},
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    },
    { onConflict: 'clip_id,stage' }
  );
}

export async function markStageComplete(clipId: string, stage: StageName, output: Record<string, unknown>) {
  const supabase = createAdminClient();
  await supabase.from('clip_pipeline_stages').upsert(
    {
      clip_id: clipId,
      stage,
      status: 'completed',
      output,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'clip_id,stage' }
  );
}

export async function markStageFailed(clipId: string, stage: StageName, error: string) {
  const supabase = createAdminClient();
  await supabase.from('clip_pipeline_stages').upsert(
    {
      clip_id: clipId,
      stage,
      status: 'failed',
      error,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'clip_id,stage' }
  );
}

export async function getCompletedStage<T = Record<string, unknown>>(
  clipId: string,
  stage: StageName
): Promise<T | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('clip_pipeline_stages')
    .select('output, status')
    .eq('clip_id', clipId)
    .eq('stage', stage)
    .maybeSingle();
  if (data && data.status === 'completed') {
    return data.output as T;
  }
  return null;
}
