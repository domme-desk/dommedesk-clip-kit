import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import type { Model, StyleLibraryItem } from '@/lib/supabase/types';

export type ScoredFrame = {
  timestamp: number;
  score: number;
  reasoning: string;
  face_visible: boolean;
  composition_notes: string;
};

export type CompositionBrief = {
  text_primary: string;
  text_secondary: string | null;
  text_position: 'top' | 'bottom' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  text_color: string;
  text_shadow: boolean;
  background_concept: string;
  background_prompt: string;
  mood: string;
};

type VisionContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } };

export async function scoreFrames(
  frameUrls: { url: string; timestamp: number }[],
  model: Model,
  styleExamples: StyleLibraryItem[],
  k: number = 3
): Promise<ScoredFrame[]> {
  const styleContext = styleExamples.length > 0
    ? `You have ${styleExamples.length} prior thumbnail examples for this creator. They inform what "good" looks like for this brand. Match that visual language.`
    : `You have no prior thumbnails for this creator yet. Use the default style prompt below.\n\nDefault style: ${model.default_style_prompt || 'tasteful and striking'}.`;

  const bannedContext = (model.banned_themes?.length || 0) > 0
    ? `Avoid frames that prominently feature these banned themes: ${model.banned_themes!.join(', ')}.`
    : '';

  const content: VisionContent[] = [];

  if (styleExamples.length > 0) {
    content.push({ type: 'text', text: `Prior thumbnails for this creator (for style reference):` });
    for (const ex of styleExamples.slice(0, 8)) {
      content.push({ type: 'image', source: { type: 'url', url: ex.asset_url } });
    }
  }

  content.push({
    type: 'text',
    text: `\nCandidate frames from the new clip, in order (frame 1 through ${frameUrls.length}):`,
  });
  for (const f of frameUrls) {
    content.push({ type: 'image', source: { type: 'url', url: f.url } });
  }

  content.push({
    type: 'text',
    text: `
Creator: ${model.display_name}
Tone: ${model.tone_notes || 'unspecified'}
${styleContext}
${bannedContext}

TASK: Score each candidate frame 0-100 for thumbnail suitability. A great thumbnail frame:
- Shows the creator's face clearly and expressively
- Has strong composition (subject well-placed, not cluttered)
- Captures a compelling moment (energy, attitude, tease, dominance — whatever matches the brand)
- Avoids awkward expressions, closed eyes, blur, or unflattering angles
- Can be the basis for an eye-catching thumbnail with a background swap and text overlay

Return ONLY valid JSON (no prose, no markdown fences) in this exact shape:

{
  "frames": [
    {
      "frame_index": 1,
      "timestamp": <number>,
      "score": <0-100>,
      "face_visible": <boolean>,
      "composition_notes": "<1 sentence>",
      "reasoning": "<1 sentence why this score>"
    }
  ]
}

Frame timestamps in order: ${JSON.stringify(frameUrls.map(f => f.timestamp))}
Return the top ${k} frames sorted by score, descending.`,
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

  const raw = textBlock.text.trim().replace(/^```json\s*|\s*```$/g, '');
  const parsed = JSON.parse(raw) as { frames: ScoredFrame[] };

  return parsed.frames
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function generateCompositionBrief(
  frameUrl: string,
  model: Model,
  styleExamples: StyleLibraryItem[]
): Promise<CompositionBrief> {
  const colors = (model.brand_colors || {}) as Record<string, string>;
  const fonts = (model.font_preferences || {}) as Record<string, string>;

  const brandContext = `
Creator: ${model.display_name}
Tone: ${model.tone_notes || 'unspecified'}
Primary brand color: ${colors.primary || 'unspecified'}
Accent brand color: ${colors.accent || 'unspecified'}
Heading font preference: ${fonts.heading || 'unspecified'}
Banned words: ${(model.banned_words || []).join(', ') || 'none'}
Banned themes: ${(model.banned_themes || []).join(', ') || 'none'}
Default style: ${model.default_style_prompt || 'tasteful and striking'}
`.trim();

  const content: VisionContent[] = [];

  if (styleExamples.length > 0) {
    content.push({ type: 'text', text: `Prior thumbnails for this creator (visual style reference):` });
    for (const ex of styleExamples.slice(0, 6)) {
      content.push({ type: 'image', source: { type: 'url', url: ex.asset_url } });
    }
  }

  content.push({ type: 'text', text: `Selected frame from new clip:` });
  content.push({ type: 'image', source: { type: 'url', url: frameUrl } });

  content.push({
    type: 'text',
    text: `
${brandContext}

TASK: Design a thumbnail composition for this clip. The final thumbnail will be built by:
1. Masking the subject out of the frame
2. Generating a thematic BACKGROUND with an AI image model
3. Compositing: generated background → masked subject → text overlay → watermark

Return ONLY valid JSON in this shape:

{
  "text_primary": "<short hook line, 2-6 words>",
  "text_secondary": "<optional subtitle, or null>",
  "text_position": "<one of: top, bottom, center, top-left, top-right, bottom-left, bottom-right>",
  "text_color": "<hex>",
  "text_shadow": <true or false>,
  "background_concept": "<short slug: money_spiral, velvet_curtain, neon_grid, chains, cash_rain, smoke_red, etc.>",
  "background_prompt": "<detailed prompt for an AI image model to generate ONLY the background. No people. 1-3 sentences.>",
  "mood": "<one word>"
}

No prose, no markdown fences.`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude for composition brief');
  }

  const raw = textBlock.text.trim().replace(/^```json\s*|\s*```$/g, '');
  return JSON.parse(raw) as CompositionBrief;
}
