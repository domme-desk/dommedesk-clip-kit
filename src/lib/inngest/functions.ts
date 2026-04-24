import { inngest } from '../inngest';
import { createAdminClient } from '@/lib/supabase/admin';
import { uploadFile } from '@/lib/supabase/storage';
import { extractFrames, downloadToTmp, cleanup } from '@/lib/ffmpeg';
import { scoreFrames, generateCompositionBrief } from '@/lib/pipeline/prompts';
import { composite } from '@/lib/pipeline/compositor';
import { removeBackground, generateBackground } from '@/lib/replicate';
import { markStageRunning, markStageComplete, markStageFailed, getCompletedStage } from '@/lib/pipeline/stages';
import fs from 'fs/promises';
import type { Model, StyleLibraryItem } from '@/lib/supabase/types';

export const processClip = inngest.createFunction(
  {
    id: 'process-clip',
    name: 'Process Clip',
    triggers: [{ event: 'clip/uploaded' }],
  },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };
    const supabase = createAdminClient();

    // --------------------------------------------------------------
    // Load clip + model + style library
    // --------------------------------------------------------------
    const ctx = await step.run('load-context', async () => {
      const { data: clip } = await supabase.from('clips').select('*').eq('id', clipId).single();
      if (!clip) throw new Error(`Clip ${clipId} not found`);

      const { data: model } = await supabase.from('models').select('*').eq('id', clip.model_id).single();
      if (!model) throw new Error(`Model ${clip.model_id} not found`);

      const { data: styleLibrary } = await supabase
        .from('style_library_items')
        .select('*')
        .eq('model_id', model.id)
        .eq('scope', 'model')
        .eq('asset_type', 'thumbnail');

      await supabase.from('clips').update({ status: 'processing', status_message: 'Loading context...' }).eq('id', clipId);

      return { clip, model: model as Model, styleLibrary: (styleLibrary || []) as StyleLibraryItem[] };
    });

    // --------------------------------------------------------------
    // Stage: Frame extraction (checkpoint)
    // --------------------------------------------------------------
    const framesOutput = await step.run('frame-extraction', async () => {
      const cached = await getCompletedStage<{ frames: { url: string; timestamp: number }[] }>(clipId, 'frame_extraction');
      if (cached && cached.frames?.length > 0) return cached;

      await markStageRunning(clipId, 'frame_extraction');
      await supabase.from('clips').update({ status_message: 'Extracting frames...' }).eq('id', clipId);

      try {
        // Download the source clip to a tmp file
        const { data: signed } = await supabase.storage
          .from('clips')
          .createSignedUrl(ctx.clip.source_url, 60 * 10);
        if (!signed?.signedUrl) throw new Error('Could not sign source clip URL');

        const ext = ctx.clip.original_filename?.split('.').pop()?.toLowerCase() || 'mp4';
        const localVideo = await downloadToTmp(signed.signedUrl, ext);

        // Extract 30 frames (60 was too many for a first test)
        const frames = await extractFrames(localVideo, 30);

        // Upload each frame to Supabase so Claude can see them via URL
        const uploaded: { url: string; timestamp: number }[] = [];
        for (const f of frames) {
          const buf = await fs.readFile(f.localPath);
          const path = `clips/${clipId}/frames/frame-${f.timestamp.toFixed(2).replace('.', '_')}.jpg`;
          const res = await uploadFile(path, buf, 'image/jpeg');
          if (!('error' in res)) {
            uploaded.push({ url: res.url, timestamp: f.timestamp });
          }
        }

        // Cleanup local files
        await cleanup(localVideo);
        for (const f of frames) await cleanup(f.localPath);

        const out = { frames: uploaded };
        await markStageComplete(clipId, 'frame_extraction', out);
        return out;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markStageFailed(clipId, 'frame_extraction', msg);
        throw err;
      }
    });

    // --------------------------------------------------------------
    // Stage: Frame scoring (Claude picks top 3)
    // --------------------------------------------------------------
    const scoredOutput = await step.run('frame-scoring', async () => {
      const cached = await getCompletedStage<{ top: { url: string; timestamp: number; score: number }[] }>(clipId, 'frame_scoring');
      if (cached && cached.top?.length > 0) return cached;

      await markStageRunning(clipId, 'frame_scoring');
      await supabase.from('clips').update({ status_message: 'Scoring frames with Claude...' }).eq('id', clipId);

      try {
        const scored = await scoreFrames(framesOutput.frames, ctx.model, ctx.styleLibrary, 3);
        const top = scored.map((s) => {
          const match = framesOutput.frames.find((f) => Math.abs(f.timestamp - s.timestamp) < 0.05) || framesOutput.frames[0];
          return { url: match.url, timestamp: s.timestamp, score: s.score };
        });
        const out = { top };
        await markStageComplete(clipId, 'frame_scoring', out);
        return out;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markStageFailed(clipId, 'frame_scoring', msg);
        throw err;
      }
    });

    // --------------------------------------------------------------
    // For each of the top 3 frames: brief + mask + background + composite
    // --------------------------------------------------------------
    for (let i = 0; i < scoredOutput.top.length; i++) {
      const variantIndex = i + 1;
      const frame = scoredOutput.top[i];

      await step.run(`variant-${variantIndex}`, async () => {
        await supabase
          .from('clips')
          .update({ status_message: `Generating variant ${variantIndex}/${scoredOutput.top.length}...` })
          .eq('id', clipId);

        // 1. Composition brief
        const brief = await generateCompositionBrief(frame.url, ctx.model, ctx.styleLibrary);

        // 2. Subject mask (RMBG)
        const subjectMaskUrl = await removeBackground(frame.url);

        // 3. Background generation (Nano Banana)
        const backgroundUrl = await generateBackground(brief.background_prompt, '16:9');

        // 4. Composite
        const composedPng = await composite({
          backgroundUrl,
          subjectMaskUrl,
          brief,
          watermarkUrl: ctx.model.watermark_url,
          watermarkPosition: ctx.model.watermark_position,
        });

        // 5. Upload final thumbnail
        const finalPath = `clips/${clipId}/thumbnails/variant-${variantIndex}.png`;
        const finalUpload = await uploadFile(finalPath, composedPng, 'image/png');
        if ('error' in finalUpload) throw new Error(`Thumbnail upload failed: ${finalUpload.error}`);

        // 6. Persist thumbnail_output row
        await supabase.from('thumbnail_outputs').insert({
          clip_id: clipId,
          image_url: finalUpload.url,
          source_frame_url: frame.url,
          source_frame_timestamp: frame.timestamp,
          composition_brief: brief as unknown as Record<string, unknown>,
          variant_index: variantIndex,
          generation_metadata: {
            score: frame.score,
            background_url: backgroundUrl,
            subject_mask_url: subjectMaskUrl,
          },
        });

        return { variantIndex };
      });
    }

    // --------------------------------------------------------------
    // Mark clip ready
    // --------------------------------------------------------------
    await step.run('mark-ready', async () => {
      await supabase
        .from('clips')
        .update({ status: 'ready', status_message: 'Thumbnails generated.' })
        .eq('id', clipId);
      return { clipId };
    });

    return { success: true, clipId };
  }
);

export const functions = [processClip];
