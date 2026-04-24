import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import type { Model, StyleLibraryItem, Clip } from '@/lib/supabase/types';

export type ScoredFrame = {
  timestamp: number;
  score: number;
  reasoning: string;
  face_visible: boolean;
  composition_notes: string;
};

export type CompositionBrief = {
  variant_index: number;
  text_primary: string;
  text_secondary: string | null;
  text_position: 'top' | 'bottom' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  text_color: string;
  text_outline_color: string;
  text_shadow: boolean;
  background_concept: string;
  background_prompt: string;
  mood: string;
};

type VisionContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripJsonFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
}

function clipContextString(clip: Pick<Clip, 'title' | 'description' | 'tags' | 'auto_description'>): string {
  const parts: string[] = [];
  if (clip.title) parts.push(`Title: ${clip.title}`);
  if (clip.tags && clip.tags.length > 0) parts.push(`Tags: ${clip.tags.join(', ')}`);
  const desc = clip.description || clip.auto_description;
  if (desc) parts.push(`Description: ${desc}`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Auto-description (Claude watches frames + reads title + learns from examples)
// ---------------------------------------------------------------------------

export async function generateAutoDescription(
  sampleFrameUrls: string[],
  clip: Pick<Clip, 'title' | 'tags' | 'description'>,
  descriptionExamples: StyleLibraryItem[],
  model: Model
): Promise<string> {
  const content: VisionContent[] = [];

  // Show examples first
  if (descriptionExamples.length > 0) {
    const exampleText = descriptionExamples
      .slice(0, 10)
      .map((ex) => {
        const title = typeof (ex.auto_tags as Record<string, unknown>)?.title === 'string'
          ? String((ex.auto_tags as Record<string, unknown>).title)
          : ex.notes || '(untitled)';
        const tags = ex.manual_tags && ex.manual_tags.length > 0
          ? ` [tags: ${ex.manual_tags.join(', ')}]`
          : '';
        return `TITLE: ${title}${tags}\nDESCRIPTION: ${ex.caption_text}`;
      })
      .join('\n\n---\n\n');

    content.push({
      type: 'text',
      text: `Here are examples of how this creator writes clip descriptions. Match this voice, tone, length, vocabulary, punctuation, and pacing precisely. Do not be more polite, less explicit, or more generic than these examples.\n\n${exampleText}\n\n---\n`,
    });
  }

  // Sampled frames from the new clip
  content.push({
    type: 'text',
    text: `Here are frames sampled across the new clip, in chronological order:`,
  });
  for (const url of sampleFrameUrls) {
    content.push({ type: 'image', source: { type: 'url', url } });
  }

  const clipCtx = clipContextString({ ...clip, auto_description: null });
  content.push({
    type: 'text',
    text: `
${clipCtx}

Creator: ${model.display_name}
Tone: ${model.tone_notes || 'unspecified'}

TASK: Write a description for this new clip in this creator's exact voice. It should:
- Read like one of the examples above, not a generic AI caption
- Reference the specific kinks / themes / scenario implied by the title, tags, and frames
- Match the length and tone of the examples
- Be usable as the published description when the clip goes live

Return ONLY the description text. No prose, no prefix, no JSON, no quotes around it.`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude for auto-description');
  }
  return textBlock.text.trim();
}

// ---------------------------------------------------------------------------
// Frame scoring with diversity enforcement
// ---------------------------------------------------------------------------

export async function scoreFrames(
  frameUrls: { url: string; timestamp: number }[],
  clip: Pick<Clip, 'title' | 'description' | 'tags' | 'auto_description'>,
  model: Model,
  styleExamples: StyleLibraryItem[],
  k: number = 3
): Promise<ScoredFrame[]> {
  const styleContext = styleExamples.length > 0
    ? `You have ${styleExamples.length} prior thumbnail examples for this creator (shown below). They define what a great thumbnail frame looks like for this brand.`
    : `No prior thumbnails for this creator. Use the default style guidance: ${model.default_style_prompt || 'tasteful, striking, strong expression'}.`;

  const bannedContext = (model.banned_themes?.length || 0) > 0
    ? `Avoid frames that prominently feature banned themes: ${model.banned_themes!.join(', ')}.`
    : '';

  const content: VisionContent[] = [];

  if (styleExamples.length > 0) {
    content.push({ type: 'text', text: `Prior thumbnail examples for this creator:` });
    for (const ex of styleExamples.slice(0, 8)) {
      content.push({ type: 'image', source: { type: 'url', url: ex.asset_url } });
    }
  }

  content.push({
    type: 'text',
    text: `\nCandidate frames from the new clip (${frameUrls.length} frames, in order):`,
  });
  for (const f of frameUrls) {
    content.push({ type: 'image', source: { type: 'url', url: f.url } });
  }

  const clipCtx = clipContextString(clip);
  const firstTs = frameUrls[0]?.timestamp ?? 0;
  const lastTs = frameUrls[frameUrls.length - 1]?.timestamp ?? 0;
  const minGap = Math.max(3, (lastTs - firstTs) * 0.1);

  content.push({
    type: 'text',
    text: `
${clipCtx}

Creator: ${model.display_name}
Tone: ${model.tone_notes || 'unspecified'}
${styleContext}
${bannedContext}

TASK: Pick the top ${k} frames for thumbnails. Requirements:
- Face visible and expressive
- Strong composition (subject well-placed, not cluttered)
- Captures a moment that matches the clip's title and tags
- DIVERSITY: the ${k} selected frames must be at least ${minGap.toFixed(1)} seconds apart in timestamp. Variants should feel visually distinct, not near-duplicates of the same pose.
- Avoid closed eyes, blur, awkward angles

Frame timestamps available: ${JSON.stringify(frameUrls.map(f => f.timestamp))}

Return ONLY valid JSON (no prose, no fences) in this exact shape:

{
  "frames": [
    {
      "timestamp": <number from the list above>,
      "score": <0-100>,
      "face_visible": <boolean>,
      "composition_notes": "<1 sentence>",
      "reasoning": "<why this frame, and why it differs from the others>"
    }
  ]
}

Return the top ${k} frames sorted by score descending.`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude for frame scoring');
  }

  const raw = stripJsonFences(textBlock.text);
  const parsed = JSON.parse(raw) as { frames: ScoredFrame[] };

  // Enforce diversity on our end too, in case Claude cheats
  const sorted = parsed.frames.sort((a, b) => b.score - a.score);
  const picked: ScoredFrame[] = [];
  for (const f of sorted) {
    if (picked.every((p) => Math.abs(p.timestamp - f.timestamp) >= minGap)) {
      picked.push(f);
      if (picked.length >= k) break;
    }
  }
  // If diversity filter left us short, fill with highest-scoring remaining
  while (picked.length < k && picked.length < sorted.length) {
    const remaining = sorted.find((f) => !picked.includes(f));
    if (!remaining) break;
    picked.push(remaining);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Coordinated composition briefs (all variants in one call)
// ---------------------------------------------------------------------------

export async function generateCompositionBriefs(
  frames: { url: string; timestamp: number }[],
  clip: Pick<Clip, 'title' | 'description' | 'tags' | 'auto_description'>,
  model: Model,
  styleExamples: StyleLibraryItem[]
): Promise<CompositionBrief[]> {
  const colors = (model.brand_colors || {}) as Record<string, string>;
  const fonts = (model.font_preferences || {}) as Record<string, string>;

  const brandContext = `
Creator: ${model.display_name}
Tone: ${model.tone_notes || 'unspecified'}
Brand colors: primary=${colors.primary || 'unspec'}, secondary=${colors.secondary || 'unspec'}, accent=${colors.accent || 'unspec'}
Heading font: ${fonts.heading || 'unspec'}
Banned words: ${(model.banned_words || []).join(', ') || 'none'}
Banned themes: ${(model.banned_themes || []).join(', ') || 'none'}
Default style: ${model.default_style_prompt || 'tasteful and striking'}
`.trim();

  const content: VisionContent[] = [];

  if (styleExamples.length > 0) {
    content.push({ type: 'text', text: `Prior thumbnail examples for this creator (style reference):` });
    for (const ex of styleExamples.slice(0, 6)) {
      content.push({ type: 'image', source: { type: 'url', url: ex.asset_url } });
    }
  }

  content.push({ type: 'text', text: `\nSelected frames for this clip (variant 1, 2, 3 in order):` });
  for (const f of frames) {
    content.push({ type: 'image', source: { type: 'url', url: f.url } });
  }

  const clipCtx = clipContextString(clip);
  content.push({
    type: 'text',
    text: `
${clipCtx}

${brandContext}

TASK: Design ${frames.length} thumbnail compositions, one per frame above. Each thumbnail is built by: AI-generated thematic background → masked subject from the frame → text overlay → watermark.

CRITICAL REQUIREMENTS:
- Each variant must use a DIFFERENT background concept (don't give all three "emerald bokeh"; give different themes that each support the clip's title/tags)
- Text for each variant must be DIFFERENT hooks — all grounded in the clip's actual title/tags/description, not generic
- text_color must contrast strongly with the planned background
- text_outline_color should be high-contrast to text_color (usually black if text is light, white if text is dark) to improve readability
- text should be 2-6 words for primary, optional short subtitle for secondary

Return ONLY valid JSON (no prose, no fences):

{
  "briefs": [
    {
      "variant_index": 1,
      "text_primary": "<short hook, 2-6 words, ALL CAPS often works>",
      "text_secondary": "<optional 2-5 word subtitle or null>",
      "text_position": "<top|bottom|center|top-left|top-right|bottom-left|bottom-right>",
      "text_color": "<hex>",
      "text_outline_color": "<hex>",
      "text_shadow": <true|false>,
      "background_concept": "<short slug: money_spiral, chains_dark, velvet_red, etc.>",
      "background_prompt": "<1-3 sentences describing ONLY the background for an AI image model. No people. Include lighting, mood, palette, camera framing. Make this specific to the clip's theme>",
      "mood": "<one word>"
    },
    ... (one object per frame)
  ]
}`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3072,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude for composition briefs');
  }
  const raw = stripJsonFences(textBlock.text);
  const parsed = JSON.parse(raw) as { briefs: CompositionBrief[] };
  return parsed.briefs;
}
