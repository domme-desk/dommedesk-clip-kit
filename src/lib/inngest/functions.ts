import { inngest } from '@/lib/inngest';
import { createAdminClient } from '@/lib/supabase/admin';
import { uploadFile } from '@/lib/supabase/storage';
import { extractFrames, downloadToTmp, cleanup } from '@/lib/ffmpeg';
import {
  scoreFrames,
  generateAutoDescription,
  selectTemplatesForClip,
} from '@/lib/pipeline/prompts';
import { renderTemplate } from '@/lib/pipeline/template-renderer';
import { removeBackground } from '@/lib/replicate';
import {
  markStageRunning,
  markStageComplete,
  markStageFailed,
  getCompletedStage,
} from '@/lib/pipeline/stages';
import { TEMPLATES } from '@/lib/pipeline/templates';
import type { Clip, Model, StyleLibraryItem } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------
// Types used across stages
// ---------------------------------------------------------------------------

type PipelineContext = {
  clip: Clip;
  model: Model;
  thumbExamples: StyleLibraryItem[];
  descExamples: StyleLibraryItem[];
};

type FrameRecord = { url: string; timestamp: number; path: string };

// ---------------------------------------------------------------------------
// processClip — main Inngest function
// ---------------------------------------------------------------------------

export const processClip = inngest.createFunction(
  {
    id: 'dommedesk-clip-kit-process-clip',
    triggers: [{ event: 'clip/uploaded' }],
  },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };
    const supabase = createAdminClient();

    // Helper: load context fresh each invocation (cheap)
    async function loadContext(): Promise<PipelineContext> {
      const { data: clipData, error: clipErr } = await supabase.from('clips').select('*').eq('id', clipId).single();
      if (clipErr || !clipData) throw new Error(`Clip not found: ${clipId}`);
      const clip = clipData as Clip;

      const { data: modelData, error: modelErr } = await supabase.from('models').select('*').eq('id', clip.model_id).single();
      if (modelErr || !modelData) throw new Error(`Model not found: ${clip.model_id}`);
      const model = modelData as Model;

      const { data: thumbExamples } = await supabase
        .from('style_library_items')
        .select('*')
        .eq('model_id', clip.model_id)
        .eq('asset_type', 'thumbnail')
        .order('created_at', { ascending: false })
        .limit(20);

      const { data: descExamples } = await supabase
        .from('style_library_items')
        .select('*')
        .eq('model_id', clip.model_id)
        .eq('asset_type', 'caption')
        .order('created_at', { ascending: false })
        .limit(20);

      return {
        clip,
        model,
        thumbExamples: (thumbExamples as StyleLibraryItem[]) || [],
        descExamples: (descExamples as StyleLibraryItem[]) || [],
      };
    }

    async function updateStatus(message: string) {
      await supabase.from('clips').update({ status_message: message }).eq('id', clipId);
    }

    await updateStatus('Loading context...');
    const ctx0 = await loadContext();
    if (!ctx0.clip.source_url) throw new Error('Clip has no source_url');

    // -----------------------------------------------------------------------
    // Stage: frame_extraction
    // -----------------------------------------------------------------------
    const framesData = await step.run('frame_extraction', async () => {
      const existing = await getCompletedStage(supabase, clipId, 'frame_extraction');
      if (existing?.output) return existing.output as { frames: FrameRecord[] };

      await markStageRunning(supabase, clipId, 'frame_extraction');
      await updateStatus('Extracting frames...');

      try {
        const tmpPath = await downloadToTmp(ctx0.clip.source_url!);
        const extracted = await extractFrames(tmpPath, 30);
        const frames: FrameRecord[] = [];

        for (let i = 0; i < extracted.length; i++) {
          const f = extracted[i];
          const buf = await (await import('fs/promises')).readFile(f.localPath);
          const storagePath = `clips/${clipId}/frames/frame-${i.toString().padStart(3, '0')}.jpg`;
          const uploadResult = await uploadFile(storagePath, buf, 'image/jpeg');
        if ('error' in uploadResult) throw new Error(`Upload failed: ${uploadResult.error}`);
        const publicUrl = uploadResult.url;
          frames.push({ url: publicUrl, timestamp: f.timestamp, path: storagePath });
        }

        await cleanup(tmpPath);
        const output = { frames };
        await markStageComplete(supabase, clipId, 'frame_extraction', output);
        return output;
      } catch (err) {
        await markStageFailed(supabase, clipId, 'frame_extraction', err instanceof Error ? err.message : String(err));
        throw err;
      }
    });

    // -----------------------------------------------------------------------
    // Stage: auto_description (runs if clip.description is blank)
    // -----------------------------------------------------------------------
    await step.run('auto_description', async () => {
      const existing = await getCompletedStage(supabase, clipId, 'auto_description');
      if (existing) return;
      if (ctx0.clip.description && ctx0.clip.description.trim().length > 0) return;

      await markStageRunning(supabase, clipId, 'auto_description');
      await updateStatus('Writing description in model voice...');

      try {
        const ctx = await loadContext();
        const sampleUrls = framesData.frames
          .filter((_, i) => i % Math.max(1, Math.floor(framesData.frames.length / 6)) === 0)
          .slice(0, 6)
          .map((f) => f.url);
        const desc = await generateAutoDescription(sampleUrls, ctx.clip, ctx.descExamples, ctx.model);
        await supabase.from('clips').update({ auto_description: desc }).eq('id', clipId);
        await markStageComplete(supabase, clipId, 'auto_description', { length: desc.length });
      } catch (err) {
        await markStageFailed(supabase, clipId, 'auto_description', err instanceof Error ? err.message : String(err));
        throw err;
      }
    });

    // -----------------------------------------------------------------------
    // Stage: frame_scoring — pick top 3 frames
    // -----------------------------------------------------------------------
    const scoredOutput = await step.run('frame_scoring', async () => {
      const existing = await getCompletedStage(supabase, clipId, 'frame_scoring');
      if (existing?.output) return existing.output as { top: { url: string; timestamp: number }[] };

      await markStageRunning(supabase, clipId, 'frame_scoring');
      await updateStatus('Scoring frames with Claude...');

      try {
        const ctx = await loadContext();
        const scored = await scoreFrames(
          framesData.frames.map((f) => ({ url: f.url, timestamp: f.timestamp })),
          ctx.clip,
          ctx.model,
          ctx.thumbExamples,
          3
        );
        const topByTimestamp = new Map(framesData.frames.map((f) => [f.timestamp, f]));
        const top = scored
          .map((s) => {
            const match = topByTimestamp.get(s.timestamp);
            return match ? { url: match.url, timestamp: s.timestamp } : null;
          })
          .filter((x): x is { url: string; timestamp: number } => x !== null);

        const output = { top };
        await markStageComplete(supabase, clipId, 'frame_scoring', output);
        return output;
      } catch (err) {
        await markStageFailed(supabase, clipId, 'frame_scoring', err instanceof Error ? err.message : String(err));
        throw err;
      }
    });

    // -----------------------------------------------------------------------
    // Stage: template_selection — Claude picks 3 templates + writes hook copy
    // -----------------------------------------------------------------------
    const selections = await step.run('template_selection', async () => {
      const existing = await getCompletedStage(supabase, clipId, 'template_selection');
      if (existing?.output) return (existing.output as { selections: Awaited<ReturnType<typeof selectTemplatesForClip>> }).selections;

      await markStageRunning(supabase, clipId, 'template_selection');
      await updateStatus('Selecting templates and writing copy...');

      try {
        const ctx = await loadContext();
        const picks = await selectTemplatesForClip(
          scoredOutput.top,
          ctx.clip,
          ctx.model,
          ctx.thumbExamples,
          ctx.descExamples
        );
        await markStageComplete(supabase, clipId, 'template_selection', { selections: picks });
        return picks;
      } catch (err) {
        await markStageFailed(supabase, clipId, 'template_selection', err instanceof Error ? err.message : String(err));
        throw err;
      }
    });

    // -----------------------------------------------------------------------
    // Stage: subject_cutouts — background removal on all unique frames needed
    // -----------------------------------------------------------------------
    const cutoutMap = await step.run('subject_cutouts', async () => {
      const existing = await getCompletedStage(supabase, clipId, 'subject_cutouts');
      if (existing?.output) return (existing.output as { map: Record<number, string> }).map;

      await markStageRunning(supabase, clipId, 'subject_cutouts');
      await updateStatus('Removing backgrounds from subjects...');

      try {
        // Figure out which frame indices are needed across all 3 templates
        const neededIndices = new Set<number>();
        for (const sel of selections) {
          const template = TEMPLATES[sel.template_id];
          if (!template) continue;
          // Use the selection's frame_indices, or fall back to [0]
          const indices = (sel.frame_indices && sel.frame_indices.length > 0) ? sel.frame_indices : [0];
          for (const idx of indices.slice(0, template.frames_needed)) {
            neededIndices.add(idx);
          }
        }

        const map: Record<number, string> = {};
        for (const idx of neededIndices) {
          const frame = scoredOutput.top[idx];
          if (!frame) continue;
          const maskUrl = await removeBackground(frame.url);

          // Download and re-upload to our storage so we own the asset
          const maskRes = await fetch(maskUrl);
          const maskBuf = Buffer.from(await maskRes.arrayBuffer());
          const storagePath = `clips/${clipId}/cutouts/cutout-${idx}-${Date.now()}.png`;
          const uploadResult = await uploadFile(storagePath, maskBuf, 'image/png');
        if ('error' in uploadResult) throw new Error(`Upload failed: ${uploadResult.error}`);
        const publicUrl = uploadResult.url;
          map[idx] = publicUrl;
        }

        // Persist cutout URLs on clip row for future reuse
        const cutoutUrls = Object.values(map);
        await supabase.from('clips').update({ cutout_urls: cutoutUrls }).eq('id', clipId);

        await markStageComplete(supabase, clipId, 'subject_cutouts', { map });
        return map;
      } catch (err) {
        await markStageFailed(supabase, clipId, 'subject_cutouts', err instanceof Error ? err.message : String(err));
        throw err;
      }
    });

    // -----------------------------------------------------------------------
    // Stage: render_variants — render each template into final thumbnail
    // -----------------------------------------------------------------------
    for (let i = 0; i < selections.length; i++) {
      const sel = selections[i];
      const template = TEMPLATES[sel.template_id];
      if (!template) continue;
      const variantIndex = i + 1;

      await step.run(`render_variant_${variantIndex}`, async () => {
        await updateStatus(`Rendering variant ${variantIndex}/${selections.length} (${template.name})...`);

        const ctx = await loadContext();

        // Pick the subject URLs this template needs
        const indices = (sel.frame_indices && sel.frame_indices.length > 0) ? sel.frame_indices : [0];
        const subjectUrls: string[] = [];
        for (let j = 0; j < template.frames_needed; j++) {
          const idx = indices[j] ?? 0;
          const url = cutoutMap[idx];
          if (!url) throw new Error(`Missing cutout for frame index ${idx}`);
          subjectUrls.push(url);
        }

        const pngBuf = await renderTemplate({
          template_id: sel.template_id,
          subject_urls: subjectUrls,
          text_primary: sel.text_primary,
          text_secondary: sel.text_secondary,
          palette: sel.palette,
          background_prompt: sel.background_prompt,
          watermark_url: ctx.model.watermark_url,
          watermark_position: (ctx.model.watermark_position as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | undefined) || 'bottom-right',
        });

        const storagePath = `clips/${clipId}/thumbnails/variant-${variantIndex}-${Date.now()}.png`;
        const uploadResult = await uploadFile(storagePath, pngBuf, 'image/png');
        if ('error' in uploadResult) throw new Error(`Upload failed: ${uploadResult.error}`);
        const publicUrl = uploadResult.url;

        await supabase.from('thumbnail_outputs').insert({
          clip_id: clipId,
          variant_index: variantIndex,
          image_url: publicUrl,
          template_id: sel.template_id,
          composition_brief: {
            template_id: sel.template_id,
            text_primary: sel.text_primary,
            text_secondary: sel.text_secondary,
            palette: sel.palette,
            reasoning: sel.reasoning,
          },
          generation_metadata: {
            template: template.name,
            frame_indices: indices,
          },
        });
      });
    }

    // -----------------------------------------------------------------------
    // Mark clip ready
    // -----------------------------------------------------------------------
    await supabase.from('clips').update({
      status: 'ready',
      status_message: 'Thumbnails generated.',
    }).eq('id', clipId);

    return { success: true, variants_rendered: selections.length };
  }
);

export const functions = [processClip];
