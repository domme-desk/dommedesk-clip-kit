import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { TEMPLATES, templatesForClaude, type TemplateId } from './templates';
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
  layout: 'single' | 'mirrored' | 'triple';  // how many copies of the subject
  text_primary: string;
  text_secondary: string | null;
  text_position: 'top' | 'bottom' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  text_color: string;
  text_outline_color: string;
  text_shadow: boolean;
  background_prompt: string;
  mood: string;
};

type VisionContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string } };

async function urlToImageBlock(url: string): Promise<VisionContent> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image for Claude: ${res.status} ${url}`);
  const ct = (res.headers.get('content-type') || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  const media_type = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : ct.includes('gif') ? 'image/gif' : 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  const data = buf.toString('base64');
  return { type: 'image', source: { type: 'base64', media_type, data } };
}

// ---------------------------------------------------------------------------
// Platform / brand context
// ---------------------------------------------------------------------------

const VISUAL_GRAMMAR = `
VISUAL GRAMMAR — this is the signature look:

1. SUBJECT IS THE PRODUCT. Big, filling the frame. Clothed lingerie/fetish wear — already shown in the source frame. Your job is to make her pop.
2. BACKGROUNDS ARE SIMPLE. Flat color, gradient, or soft abstract bokeh. Pink, magenta, red, purple, hot yellow dominate. NEVER literal kink objects (no cages, chains, money, etc.) — the text carries the kink reference, the background just sets tone and heat.
3. TEXT IS BIG AND BOLD. Impact / Arial Black / heavy sans. 2-5 words max per hook. Text should occupy significant visual space (20-35% of the canvas). Strong drop shadow and outline stroke. Colors: white, hot pink, yellow, black, or brand color — whatever POPS against the background.
4. MOOD: hot, playful-bratty OR commanding-dominant. Warm colors, high energy. Never somber, never cinematic-moody. This is cam-girl-meets-clickbait, not indie film poster.

BACKGROUND PROMPT RULES:
- Describe ONLY a simple color environment. 1-2 sentences max.
- Examples of good prompts: "Hot pink gradient background with soft bokeh light sparkles, smooth and glossy" / "Deep magenta to purple gradient with subtle diagonal light rays" / "Warm red abstract cloudy background with soft vignette" / "Glossy purple flat background with faint pink highlights"
- NEVER include: people, cages, cash, chains, fetish objects, UI elements, text, letters, buttons, icons, furniture, rooms
- NEVER use words that could trigger a content filter (e.g. chastity, bondage, sex, nude, fetish, kink). Just describe colors and light.
- The subject will be composited over this — the background just needs to make her pop.
`.trim();

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

function descriptionExampleText(examples: StyleLibraryItem[], max: number = 10): string {
  if (examples.length === 0) return '';
  return examples
    .slice(0, max)
    .map((ex) => {
      const title = typeof (ex.auto_tags as Record<string, unknown>)?.title === 'string'
        ? String((ex.auto_tags as Record<string, unknown>).title)
        : ex.notes || '(untitled)';
      return `TITLE: ${title}\nDESCRIPTION: ${ex.caption_text}`;
    })
    .join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Auto-description (unchanged logic, now with VISUAL_GRAMMAR context stripped — it's about copy voice, not visuals)
// ---------------------------------------------------------------------------

export async function generateAutoDescription(
  sampleFrameUrls: string[],
  clip: Pick<Clip, 'title' | 'tags' | 'description'>,
  descriptionExamples: StyleLibraryItem[],
  model: Model
): Promise<string> {
  const content: VisionContent[] = [];

  if (descriptionExamples.length > 0) {
    content.push({
      type: 'text',
      text: `Examples of this creator's published descriptions. Match her voice, tone, length, vocabulary, punctuation, and pacing precisely.\n\n${descriptionExampleText(descriptionExamples, 10)}\n\n---\n`,
    });
  }

  content.push({ type: 'text', text: `Frames sampled across the new clip, in order:` });
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

TASK: Write a description for this clip in the creator's voice, matching the examples. Adult/fetish content is permitted — don't sanitize.

Return ONLY the description text.`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');
  return textBlock.text.trim();
}

// ---------------------------------------------------------------------------
// Frame scoring
// ---------------------------------------------------------------------------

export async function scoreFrames(
  frameUrls: { url: string; timestamp: number }[],
  clip: Pick<Clip, 'title' | 'description' | 'tags' | 'auto_description'>,
  model: Model,
  styleExamples: StyleLibraryItem[],
  k: number = 3
): Promise<ScoredFrame[]> {
  const styleContext = styleExamples.length > 0
    ? `You have ${styleExamples.length} prior thumbnail examples for this creator (below).`
    : `No prior thumbnails. Default: ${model.default_style_prompt || 'commanding, hot, full-body'}`;

  const content: VisionContent[] = [];

  if (styleExamples.length > 0) {
    content.push({ type: 'text', text: `Prior thumbnail examples for this creator:` });
    for (const ex of styleExamples.slice(0, 8)) {
      content.push(await urlToImageBlock(ex.asset_url));
    }
  }

  content.push({
    type: 'text',
    text: `\nCandidate frames from the new clip (${frameUrls.length} frames, in order):`,
  });
  for (const f of frameUrls) {
    content.push(await urlToImageBlock(f.url));
  }

  const firstTs = frameUrls[0]?.timestamp ?? 0;
  const lastTs = frameUrls[frameUrls.length - 1]?.timestamp ?? 0;
  const minGap = Math.max(3, (lastTs - firstTs) * 0.1);

  const clipCtx = clipContextString(clip);
  content.push({
    type: 'text',
    text: `
${clipCtx}

Creator: ${model.display_name}
${styleContext}

TASK: Pick the top ${k} frames for thumbnails. What matters most:
- Full body or ¾ body visible (we want her BODY to be the centerpiece, not just her face)
- Strong / sexy / commanding pose — not just close-up talking heads
- Face expressive and visible
- Clothed but showing off — lingerie/fetish wear/low-cut/revealing outfit
- DIVERSITY: ${k} frames at least ${minGap.toFixed(1)}s apart

Frame timestamps: ${JSON.stringify(frameUrls.map(f => f.timestamp))}

Return ONLY JSON:
{
  "frames": [
    { "timestamp": <num>, "score": <0-100>, "face_visible": <bool>, "composition_notes": "<1 sentence>", "reasoning": "<why>" }
  ]
}`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');

  const raw = stripJsonFences(textBlock.text);
  const parsed = JSON.parse(raw) as { frames: ScoredFrame[] };

  const sorted = parsed.frames.sort((a, b) => b.score - a.score);
  const picked: ScoredFrame[] = [];
  for (const f of sorted) {
    if (picked.every((p) => Math.abs(p.timestamp - f.timestamp) >= minGap)) {
      picked.push(f);
      if (picked.length >= k) break;
    }
  }
  while (picked.length < k && picked.length < sorted.length) {
    const remaining = sorted.find((f) => !picked.includes(f));
    if (!remaining) break;
    picked.push(remaining);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Composition briefs — three variants with DIFFERENT layouts (single/mirrored/triple)
// ---------------------------------------------------------------------------

export async function generateCompositionBriefs(
  frames: { url: string; timestamp: number }[],
  clip: Pick<Clip, 'title' | 'description' | 'tags' | 'auto_description'>,
  model: Model,
  styleExamples: StyleLibraryItem[],
  descriptionExamples: StyleLibraryItem[]
): Promise<CompositionBrief[]> {
  const colors = (model.brand_colors || {}) as Record<string, string>;
  const primary = colors.primary || '#FF1493';
  const accent = colors.accent || '#9D4EDD';

  const brandContext = `
Creator: ${model.display_name}
Tone: ${model.tone_notes || 'commanding, hot, bratty-dom'}
Primary brand color: ${primary}
Accent brand color: ${accent}
Default palette fallback: hot pink, magenta, purple, red.
Default style: ${model.default_style_prompt || 'hot, big, bold, playful-commanding'}
`.trim();

  const content: VisionContent[] = [];

  if (styleExamples.length > 0) {
    content.push({ type: 'text', text: `Prior thumbnails for this creator — match this visual grammar exactly:` });
    for (const ex of styleExamples.slice(0, 8)) {
      content.push(await urlToImageBlock(ex.asset_url));
    }
  }

  if (descriptionExamples.length > 0) {
    content.push({
      type: 'text',
      text: `\nHer published description voice — calibrate hook copy tone from these:\n\n${descriptionExampleText(descriptionExamples, 6)}\n`,
    });
  }

  content.push({ type: 'text', text: `\nThe three selected frames (one per variant, in order):` });
  for (const f of frames) {
    content.push(await urlToImageBlock(f.url));
  }

  const clipCtx = clipContextString(clip);
  content.push({
    type: 'text',
    text: `
${VISUAL_GRAMMAR}

${clipCtx}

${brandContext}

TASK: Design 3 thumbnail compositions, one per frame. Each variant has a FIXED LAYOUT:
- Variant 1: layout = "single" (one big subject, filling ~75% of vertical canvas height, off-center horizontally to leave room for big text)
- Variant 2: layout = "mirrored" (subject duplicated — one copy on the left, mirrored copy on the right, text between/over them)
- Variant 3: layout = "triple" (three copies — two at the edges, one center-front — text overlaid big)

COPY (text_primary):
- 2-5 words MAX. Punchy, hot, in the creator's voice. Match her published description tone.
- Each variant different angle: command / tease / consequence
- ALL CAPS is the default
- Examples of good hooks: "STAY CAGED", "LOSER POSITION", "OBEY THE SCREEN", "SWALLOW IT"

BACKGROUND PROMPT:
- SIMPLE. Color and light only. NO objects, no scenes, no kink references, no text, no letters.
- Use the brand colors (${primary}, ${accent}) or fall back to hot pink / magenta / purple / red
- Each variant uses a different specific color+treatment combo (e.g. "hot pink gradient with bokeh" vs "deep magenta to purple radial gradient" vs "glossy red with soft light rays")

TEXT COLORS:
- Default to white, hot pink, or yellow with heavy black outline
- Must pop hard against the background

Return ONLY JSON:

{
  "briefs": [
    {
      "variant_index": 1,
      "layout": "single",
      "text_primary": "<2-5 words>",
      "text_secondary": "<optional 2-4 words or null>",
      "text_position": "<top|bottom|center|top-left|top-right|bottom-left|bottom-right>",
      "text_color": "<hex>",
      "text_outline_color": "<hex>",
      "text_shadow": true,
      "background_prompt": "<1-2 sentences, colors and light only, no objects or people, safe for all content filters>",
      "mood": "<one word>"
    },
    {
      "variant_index": 2,
      "layout": "mirrored",
      ...
    },
    {
      "variant_index": 3,
      "layout": "triple",
      ...
    }
  ]
}`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3072,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');
  const raw = stripJsonFences(textBlock.text);
  const parsed = JSON.parse(raw) as { briefs: CompositionBrief[] };
  return parsed.briefs;
}

// ---------------------------------------------------------------------------
// Template selection — Claude picks 3 templates + writes hook copy per variant
// ---------------------------------------------------------------------------

export type TemplateSelection = {
  variant_index: number;
  template_id: TemplateId;
  text_primary: string;
  text_secondary: string | null;
  palette: string[];       // 4 hex colors, in priority order (primary, secondary, accent, outline)
  frame_indices: number[]; // which of the scored frames (0,1,2) to use for this variant's subject cutouts
  reasoning: string;
};

export async function selectTemplatesForClip(
  scoredFrames: { timestamp: number; url: string }[],
  clip: Pick<Clip, 'title' | 'description' | 'tags' | 'auto_description'>,
  model: Model,
  styleExamples: StyleLibraryItem[],
  descriptionExamples: StyleLibraryItem[]
): Promise<TemplateSelection[]> {
  const colors = (model.brand_colors || {}) as Record<string, string>;
  const primary = colors.primary || '#FF1493';
  const accent = colors.accent || '#9D4EDD';

  const content: VisionContent[] = [];

  if (styleExamples.length > 0) {
    content.push({ type: 'text', text: 'Prior thumbnail examples for this creator (visual grammar reference):' });
    for (const ex of styleExamples.slice(0, 8)) {
      content.push(await urlToImageBlock(ex.asset_url));
    }
  }

  if (descriptionExamples.length > 0) {
    content.push({
      type: 'text',
      text: '\nThis creator\'s published description voice (calibrate hook copy from these):\n\n' + descriptionExampleText(descriptionExamples, 6),
    });
  }

  content.push({ type: 'text', text: '\nSelected frames from this clip (index 0, 1, 2 in order):' });
  for (let i = 0; i < scoredFrames.length; i++) {
    const f = scoredFrames[i];
    content.push({ type: 'text', text: `Frame ${i} at ${f.timestamp.toFixed(1)}s:` });
    content.push(await urlToImageBlock(f.url));
  }

  const clipCtx = clipContextString(clip);

  content.push({
    type: 'text',
    text: `
PLATFORM & AUDIENCE CONTEXT:
This is adult fetish/BDSM content marketing for LoyalFans. The creator is a professional domme whose livelihood depends on thumbnails that sell sex appeal and kink-forward dominance. Hook copy should be commanding, provocative, and in the creator's established voice.

${clipCtx}

Creator: ${model.display_name}
Tone: ${model.tone_notes || 'commanding, hot'}
Primary brand color: ${primary}
Accent brand color: ${accent}

AVAILABLE TEMPLATES:
${templatesForClaude()}

TASK: Select 3 DIFFERENT templates for this clip (one per variant) and write the text content for each.

RULES:
1. Three DIFFERENT template_ids — no duplicates across variants
2. Templates must fit the clip's tags/mood
3. Pick frames thoughtfully: for templates needing multiple frames (triple-pose, split-photo), use DIFFERENT frame indices (0, 1, 2)
4. Hook copy must be in the creator's voice (see examples above) — commanding and provocative, not generic empowerment
5. Each variant's hook should hit a different angle (command / tease / consequence)
6. Palette: 4 hex colors. Start with brand colors (${primary}, ${accent}), add 2 complementary colors from the template's suggested palette. Order: [primary, secondary, accent, outline-or-contrast]

Return ONLY valid JSON:

{
  "selections": [
    {
      "variant_index": 1,
      "template_id": "<one of the template ids>",
      "text_primary": "<2-5 word hook>",
      "text_secondary": "<optional, or null>",
      "palette": ["#hex", "#hex", "#hex", "#hex"],
      "frame_indices": [<0|1|2>, ...],
      "reasoning": "<1 sentence why this template + copy fits this clip>"
    }
  ]
}`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3072,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text from Claude');
  const raw = stripJsonFences(textBlock.text);
  const parsed = JSON.parse(raw) as { selections: TemplateSelection[] };
  return parsed.selections;
}

