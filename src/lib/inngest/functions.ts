import { inngest } from '../inngest';
import { createAdminClient } from '@/lib/supabase/admin';
import { uploadFile } from '@/lib/supabase/storage';
import { extractFrames, downloadToTmp, cleanup } from '@/lib/ffmpeg';
import {
  scoreFrames,
  generateCompositionBriefs,
  generateAutoDescription,
} from '@/lib/pipeline/prompts';
import { composite } from '@/lib/pipeline/compositor';
import { removeBackground, generateBackground } from '@/lib/replicate';
import {
  markStageRunning,
  markStageComplete,
  markStageFailed,
  getCompletedStage,
} from '@/lib/pipeline/stages';
import fs from 'fs/promises';
import type { Model, StyleLibraryItem, Clip } from '@/lib/supabase/types';

export const processClip = inngest.createFunction(
  {
    id: 'process-clip',
    name: 'Process Clip',
    triggers: [{ event: 'clip/uploaded' }],
  },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };
    const supabase = createAdminClient();

    // -----------------------------------------------------------------
    // Load context: clip, model, thumbnail examples, description examples
    // -----------------------------------------------------------------
    const ctx = await step.run('load-context', async () => {
      const { data: clip } = await supabase.from('clips').select('*').eq('id', clipId).single();
      if (!clip) throw new Error(`Clip ${clipId} not found`);

      const { data: model } = await supabase.from('models').select('*').eq('id', clip.model_id).single();
      if (!model) throw new Error(`Model ${clip.model_id} not found`);

      const { data: thumbExamples } = await supabase
        .from('style_library_items')
        .select('*')
        .eq('model_id', model.id)
        .eq('scope', 'model')
        .eq('asset_type', 'thumbnail');

      const { data: descExamples } = await supabase
        .from('style_library_items')
        .select('*')
        .eq('model_id', model.id)
        .eq('scope', 'model')
        .eq('asset_type', 'caption');

      await supabase.from('clips').update({ status: 'processing', status_message: 'Loading context...' }).eq('id', clipId);

      return {
        clip: clip as Clip,
        model: model as Model,
        thumbExamples: (thumbExamples || []) as StyleLibraryItem[],
        descExamples: (descExamples || []) as StyleLibraryItem[],
      };
    });

    // -----------------------------------------------------------------
    // Stage: Frame extraction
    // -----------------------------------------------------------------
    const framesOutput = await step.run('frame-extraction', async () => {
      const cached = await getCompletedStage<{ frames: { url: string; timestamp: number }[] }>(clipId, 'frame_extraction');
      if (cached && cached.frames?.length > 0) return cached;

      await markStageRunning(clipId, 'frame_extraction');
      await supabase.from('clips').update({ status_message: 'Extracting frames...' }).eq('id', clipId);

      try {
        const { data: signed } = await supabase.storage
          .from('clips')
          .createSignedUrl(ctx.clip.source_url, 60 * 10);
        if (!signed?.signedUrl) throw new Error('Could not sign source clip URL');

        const ext = ctx.clip.original_filename?.split('.').pop()?.toLowerCase() || 'mp4';
        const localVideo = await downloadToTmp(signed.signedUrl, ext);

        const frames = await extractFrames(localVideo, 30);

        const uploaded: { url: string; timestamp: number }[] = [];
        for (const f of frames) {
          const buf = await fs.readFile(f.localPath);
          const path = `clips/${clipId}/frames/frame-${f.timestamp.toFixed(2).replace('.', '_')}.jpg`;
          const res = await uploadFile(path, buf, 'image/jpeg');
          if (!('error' in res)) {
            uploaded.push({ url: res.url, timestamp: f.timestamp });
          }
        }

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

    // -----------------------------------------------------------------
    // Stage: Auto-description (if user didn't supply one)
    // -----------------------------------------------------------------
    const autoDescOutput = await step.run('auto-description', async () => {
      const cached = await getCompletedStage<{ description: string | null }>(clipId, 'auto_description' as 'frame_extraction');
      if (cached && cached.description !== undefined) return cached;

      // If user supplied a description, use that and skip AI generation
      if (ctx.clip.description && ctx.clip.description.trim().length > 0) {
        const out = { description: ctx.clip.description };
        await markStageComplete(clipId, 'auto_description' as 'frame_extraction', out);
        return out;
      }

      await markStageRunning(clipId, 'auto_description' as 'frame_extraction');
      await supabase.from('clips').update({ status_message: 'Writing description...' }).eq('id', clipId);

      try {
        // Sample ~6 frames spread across the clip
        const sampled = framesOutput.frames
          .filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 6)) === 0)
          .slice(0, 6)
          .map((f) => f.url);

        const description = await generateAutoDescription(
          sampled,
          ctx.clip,
          ctx.descExamples,
          ctx.model
        );

        // Save back to clip row
        await supabase.from('clips').update({ auto_description: description }).eq('id', clipId);

        const out = { description };
        await markStageComplete(clipId, 'auto_description' as 'frame_extraction', out);
        return out;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markStageFailed(clipId, 'auto_description' as 'frame_extraction', msg);
        throw err;
      }
    });

    // Update the clip object with the resolved description for downstream stages
    const enrichedClip: Clip = {
      ...ctx.clip,
      auto_description: autoDescOutput.description,
    };

    // -----------------------------------------------------------------
    // Stage: Frame scoring (diverse top 3)
    // -----------------------------------------------------------------
    const scoredOutput = await step.run('frame-scoring', async () => {
      const cached = await getCompletedStage<{ top: { url: string; timestamp: number; score: number }[] }>(clipId, 'frame_scoring');
      if (cached && cached.top?.length > 0) return cached;

      await markStageRunning(clipId, 'frame_scoring');
      await supabase.from('clips').update({ status_message: 'Scoring frames with Claude...' }).eq('id', clipId);

      try {
        const scored = await scoreFrames(
          framesOutput.frames,
          enrichedClip,
          ctx.model,
          ctx.thumbExamples,
          3
        );
        const top = scored.map((s) => {
          const match =
            framesOutput.frames.find((f) => Math.abs(f.timestamp - s.timestamp) < 0.05) ||
            framesOutput.frames[0];
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

    // -----------------------------------------------------------------
    // Stage: Coordinated composition briefs (all 3 in one call)
    // -----------------------------------------------------------------
    const briefsOutput = await step.run('composition-briefs', async () => {
      const cached = await getCompletedStage<{ briefs: unknown[] }>(clipId, 'composition_briefs');
      if (cached && Array.isArray(cached.briefs) && cached.briefs.length > 0) return cached;

      await markStageRunning(clipId, 'composition_briefs');
      await supabase.from('clips').update({ status_message: 'Designing thumbnails...' }).eq('id', clipId);

      try {
        const briefs = await generateCompositionBriefs(
          scoredOutput.top,
          enrichedClip,
          ctx.model,
          ctx.thumbExamples
        );
        const out = { briefs };
        await markStageComplete(clipId, 'composition_briefs', out);
        return out;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markStageFailed(clipId, 'composition_briefs', msg);
        throw err;
      }
    });

    // -----------------------------------------------------------------
    // For each variant: mask + background + composite
    // -----------------------------------------------------------------
    const briefs = (briefsOutput.briefs as ReturnType<typeof generateCompositionBriefs> extends Promise<infer R> ? R : never);
    for (let i = 0; i < scoredOutput.top.length; i++) {
      const variantIndex = i + 1;
      const frame = scoredOutput.top[i];
      const brief = briefs[i] || briefs[briefs.length - 1];

      await step.run(`variant-${variantIndex}`, async () => {
        await supabase
          .from('clips')
          .update({ status_message: `Generating variant ${variantIndex}/${scoredOutput.top.length}...` })
          .eq('id', clipId);

        const subjectMaskUrl = await removeBackground(frame.url);
        const backgroundUrl = await generateBackground(brief.background_prompt, '16:9');

        const composedPng = await composite({
          backgroundUrl,
          subjectMaskUrl,
          brief,
          watermarkUrl: ctx.model.watermark_url,
          watermarkPosition: ctx.model.watermark_position,
        });

        const finalPath = `clips/${clipId}/thumbnails/variant-${variantIndex}.png`;
        const finalUpload = await uploadFile(finalPath, composedPng, 'image/png');
        if ('error' in finalUpload) throw new Error(`Thumbnail upload failed: ${finalUpload.error}`);

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
