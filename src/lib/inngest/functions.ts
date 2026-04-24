import { inngest } from '../inngest';
import { createAdminClient } from '@/lib/supabase/admin';

export const processClip = inngest.createFunction(
  {
    id: 'process-clip',
    name: 'Process Clip',
    triggers: [{ event: 'clip/uploaded' }],
  },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };

    // Step 1: Mark as processing
    await step.run('mark-processing', async () => {
      const supabase = createAdminClient();
      await supabase
        .from('clips')
        .update({ status: 'processing', status_message: 'Starting pipeline...' })
        .eq('id', clipId);
      return { clipId };
    });

    // STUB: real pipeline steps go here
    // - extract frames
    // - score frames with Claude
    // - generate composition briefs
    // - mask subject (RMBG)
    // - generate backgrounds (Nano Banana)
    // - composite final thumbnails
    await step.sleep('simulated-work', '2s');

    // Step N: Mark as ready
    await step.run('mark-ready', async () => {
      const supabase = createAdminClient();
      await supabase
        .from('clips')
        .update({
          status: 'ready',
          status_message: 'Pipeline complete (stub — no outputs generated yet)',
        })
        .eq('id', clipId);
      return { clipId };
    });

    return { success: true, clipId };
  }
);

export const functions = [processClip];
