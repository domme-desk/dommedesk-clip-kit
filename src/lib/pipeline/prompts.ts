import { anthropic, CLAUDE_MODEL } from '@/lib/anthropic';
import { TEMPLATES, templatesForClaude, type TemplateId } from './templates';
import type { Model, StyleLibraryItem, Clip } from '@/lib/supabase/types';
import type { FontKey } from './fonts';

export type ScoredFrame = {
  timestamp: number;
  score: number;
  reasoning: string;
  face_visible: boolean;
  composition_notes: string;
};

export type FillBox = {
  color: string;                  // hex bg color
  padding_x_pct?: number;         // horizontal padding as fraction of font size (default 0.25)
  padding_y_pct?: number;         // vertical padding as fraction of font size (default 0.10)
  rotation_deg?: number;          // overrides line's rotation_deg if set
  border_radius_pct?: number;     // rounded corners (default 0 = sharp)
};

export type LockupLine = {
  text: string;
  font: FontKey;
  size_pct: number;
  fill: string;
  outline_color: string;
  outline_width_pct?: number;
  italic?: boolean;
  letter_spacing_pct?: number;
  shadow?: boolean;
  glow_color?: string | null;
  rotation_deg?: number;
  fill_box?: FillBox;             // when set, draw filled rect behind text (tag-box style)
};

export type CompositionBrief = {
  variant_index: number;
  layout: 'single' | 'mirrored' | 'triple';
  template_id?: string;
  lockup: LockupLine[];          // 1-5 lines, top-to-bottom stack
  text_position: 'top' | 'bottom' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  background_prompt: string;
  mood: string;
};

type VisionContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string } }
  | { type: 'image'; source: { type: 'url'; url: string } };

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
  let s = text.trim();
  // Remove code fences
  s = s.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '');
  s = s.trim();

  // Extract the first balanced JSON object { ... }
  const start = s.indexOf('{');
  if (start === -1) return s;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return s.substring(start, i + 1);
      }
    }
  }
  // Fallback: return from first { to end
  return s.substring(start);
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

FOCAL ANATOMY — MOST IMPORTANT:
The single most critical criterion is that the thumbnail FEATURES WHAT THE CLIP IS SELLING. The frame must put the kink's focal body part front-and-center. This is how professional thumbnails convert browsers into buyers.

Use this mapping based on the clip's tags/title to decide what the frame should feature:

- **Ass worship / ass tease / twerking** → frame must prominently feature the ASS (rear view, bent over, ass-forward pose). Subject may or may not be looking back at camera.
- **Foot worship / feet / soles** → frame must prominently feature the FEET (pointed toes, soles visible, heels off).
- **Armpit worship** → frame must have an ARM RAISED showing the armpit.
- **Breast worship / tits / cleavage** → frame must prominently feature the CLEAVAGE / chest.
- **Thigh / leg worship / stockings** → frame must prominently feature the LEGS (usually in stockings or bare).
- **Hand fetish / JOI** → frame must show HANDS (finger-wagging, countdown gestures, dominant hand pose).
- **Ignore / turn-away / mocking** → frame should show subject NOT looking at camera (looking away, on her phone, turned aside).
- **Findom / paypig / wallet drain** → commanding face + hand gestures toward camera (reaching for cash metaphor) or direct confrontational pose.
- **Chastity / lock-up** → subject in commanding pose, looking directly at camera with authoritative expression (the VIEWER is the one locked, she's telling them).
- **Hypno / mesmerize / goon** → direct eye contact, front-facing, hypnotic pose.
- **Tease / flirt / seduction** → front-facing, playful or sultry expression, lingerie visible.
- **Humiliation / SPH / loser tasks** → mocking facial expression (smirk, laugh, pointed finger), direct eye contact.

DEFAULT (if no specific focal anatomy matches the tags): prefer frames with DIRECT EYE CONTACT and a commanding/sultry pose facing the camera. This is the baseline for professional domme thumbnails.

Current clip tags: ${(clip.tags || []).join(', ') || 'none'}
Current clip title: ${clip.title || '(untitled)'}

Based on these tags and title, identify the focal anatomy/pose required, and prefer frames that deliver it.

OTHER CRITERIA:
- Full body or ¾ body visible (we want her BODY to be the centerpiece, not just her face)
- Strong / sexy / commanding pose — not just close-up talking heads  
- Face expressive and clearly visible
- Clothed but showing off — lingerie/fetish wear/low-cut/revealing outfit
- DIVERSITY: ${k} frames at least ${minGap.toFixed(1)}s apart

When scoring, heavily weight the eye contact criterion above all else (except diversity).

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
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');

  const raw = stripJsonFences(textBlock.text);
  let parsed: { frames: ScoredFrame[] };
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    console.error('[scoreFrames] JSON parse failed. Raw response was:', textBlock.text.substring(0, 500));
    throw new Error(`scoreFrames JSON parse: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
  }

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

LOCKUP — the text composition is now a STACK of styled lines, like a poster lockup.
Each variant returns a "lockup" array of 1-5 lines (1-2 is most common, 3 is dramatic, 4-5 is RARE — only for layered hooks).

Each line picks its OWN font, size, fill color, outline color, italic, shadow, glow.
This is how you get reference looks like "LOCKED UP" (Impact white) → "& RUINED" (Pinyon Script pink italic).

AVAILABLE FONTS (FontKey values you may use):
- Heavy display: 'anton', 'bebas-neue', 'bowlby-one', 'fredoka-one', 'alfa-slab-one', 'rubik-mono-one', 'passion-one', 'abril-fatface', 'monoton'
- Heavy sans-black: 'montserrat-black'
- Elegant serif: 'playfair-display-black', 'yeseva-one'
- Script (use sparingly, larger size, thicker outline): 'dancing-script', 'pacifico', 'pinyon-script', 'sacramento', 'caveat'
- Tech/futuristic: 'orbitron'
- Handwritten/marker: 'permanent-marker'

LOCKUP DESIGN RULES:
- 1-2 lines is default. Use 3 only when you have a clear primary + accent + tag structure.
- Sum of size_pct across all lines should be 0.20-0.45 (so the lockup fills 20-45% of vertical canvas).
- The BIGGEST line is the hook. Smaller lines support it.
- Mix styles for contrast: heavy display + script accent, or all-caps display + italicized rejoinder.
- ALL CAPS for display fonts. Mixed case OK for scripts and serifs.
- Each line picks its own fill from the punchy palette: white, yellow, gold-yellow, orange, red, crimson, hot-pink, magenta, cyan, electric-blue, royal-blue, lime, neon-green, electric-purple, or black.
- Outline is almost always #000000 (black). For black fills use #FFFFFF (white) outline.
- Use italic on script lines for emotion. Avoid italic on heavy display — looks weak.
- glow_color is optional and rare — use only when fill is a bright color and you want neon punch.
- rotation_deg between -8 and 8 degrees for accent lines that should feel scrawled or stamped.

COPY rules per line:
- 1-4 words per line, 5 max. Punchy, hot, in the creator's voice.
- Each variant different angle: command / tease / consequence
- Examples of good hooks: "STAY CAGED", "LOSER POSITION", "OBEY THE SCREEN", "SWALLOW IT"
- Lockup examples (these mirror real high-performing creator thumbnails):
   * "Locked Up & Ruined" pattern — heavy display + script accent:
     [{text:"LOCKED UP", font:"bowlby-one", size_pct:0.20, fill:"#FFFFFF", outline_color:"#000000"},
      {text:"& Ruined", font:"pinyon-script", size_pct:0.16, fill:"#FF1493", outline_color:"#000000", italic:true, rotation_deg:-3}]
   * "Born Again Virgin" pattern — display word + tagged accent box:
     [{text:"BORN AGAIN", font:"anton", size_pct:0.22, fill:"#FFFFFF", outline_color:"#000000"},
      {text:"VIRGIN", font:"anton", size_pct:0.13, fill:"#FFFFFF", outline_color:"#FF1493", rotation_deg:-3, fill_box:{color:"#FF1493", padding_x_pct:0.30, padding_y_pct:0.12, rotation_deg:-3}}]
   * "Goddess of Gooning" pattern — three-line vertical stack with connector:
     [{text:"GODDESS", font:"playfair-display-black", size_pct:0.18, fill:"#FFEB3B", outline_color:"#000000"},
      {text:"OF", font:"playfair-display-black", size_pct:0.10, fill:"#FFEB3B", outline_color:"#000000"},
      {text:"GOONING", font:"playfair-display-black", size_pct:0.18, fill:"#FFEB3B", outline_color:"#000000"}]
   * "Premie Challenge" pattern — two big display words + supporting subtitle:
     [{text:"PREMIE CHALLENGE", font:"anton", size_pct:0.18, fill:"#FFFFFF", outline_color:"#000000"},
      {text:"5 MINUTES TO GOON", font:"bebas-neue", size_pct:0.08, fill:"#FFFFFF", outline_color:"#000000"}]
   * "Trying Not to Relapse?" pattern — stacked display + box-tagged accent:
     [{text:"TRYING", font:"anton", size_pct:0.16, fill:"#FFFFFF", outline_color:"#000000"},
      {text:"NOT TO", font:"anton", size_pct:0.10, fill:"#FFFFFF", outline_color:"#000000"},
      {text:"RELAPSE?", font:"anton", size_pct:0.16, fill:"#FFFFFF", outline_color:"#000000", fill_box:{color:"#FF1744"}}]
   * "Warning: This Will Cause Damage" pattern — three-line all-display, biggest first:
     [{text:"WARNING:", font:"alfa-slab-one", size_pct:0.16, fill:"#FF1744", outline_color:"#000000"},
      {text:"THIS WILL CAUSE", font:"anton", size_pct:0.13, fill:"#FFFFFF", outline_color:"#000000"},
      {text:"DAMAGE", font:"anton", size_pct:0.18, fill:"#FFFFFF", outline_color:"#000000"}]
   * "Princess Mindfuck" pattern — display + flowing script:
     [{text:"PRINCESS", font:"montserrat-black", size_pct:0.13, fill:"#FFFFFF", outline_color:"#000000"},
      {text:"Mindfuck", font:"sacramento", size_pct:0.20, fill:"#FFEB3B", outline_color:"#000000", italic:true}]
   * Single-line bold (use when copy is one strong word/phrase):
     [{text:"OBEY", font:"anton", size_pct:0.30, fill:"#FFFFFF", outline_color:"#000000"}]

DESIGN GUIDANCE FROM REAL REFERENCES:
- 1-line lockups work best for ALL CAPS power words (3-8 chars): "OBEY", "SWALLOW IT", "GIRLCOCK"
- 2-line lockups are the sweet spot — primary hook + accent (~70% of references use this)
- 3-line lockups when you have command + qualifier + payoff (Goddess Of Gooning, Warning This Will Cause Damage)
- 4-5 lines is RARE — only when narrative demands it
- fill_box is a signature element: rotated colored rect behind a single accent word. Use it on ONE line max per lockup. Pink (#FF1493), red (#FF1744), or hot magenta (#FF00FF) are the classic box colors.
- Script fonts (pinyon-script, sacramento, dancing-script, pacifico, caveat) ALWAYS get italic:true and a slight rotation_deg between -5 and -2 for that hand-stamped feel.
- When a script line is paired with a display line, make the script larger or comparable — never smaller. Script as accent, but visually equal-or-greater weight.

BACKGROUND PROMPT:
- SIMPLE. Color and light only. NO objects, no scenes, no kink references, no text, no letters.
- Use the brand colors (${primary}, ${accent}) or fall back to hot pink / magenta / purple / red
- Each variant uses a different specific color+treatment combo

Return ONLY JSON:

{
  "briefs": [
    {
      "variant_index": 1,
      "layout": "single",
      "lockup": [
        { "text": "<words>", "font": "<FontKey>", "size_pct": 0.22, "fill": "#hex", "outline_color": "#000000", "italic": false, "shadow": true, "rotation_deg": 0 }
      ],
      "text_position": "<top|bottom|center|top-left|top-right|bottom-left|bottom-right>",
      "background_prompt": "<1-2 sentences, colors and light only>",
      "mood": "<one word>"
    },
    {
      "variant_index": 2,
      "layout": "mirrored",
      "lockup": [...],
      "text_position": "...",
      "background_prompt": "...",
      "mood": "..."
    },
    {
      "variant_index": 3,
      "layout": "triple",
      "lockup": [...],
      "text_position": "...",
      "background_prompt": "...",
      "mood": "..."
    }
  ]
}`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 6144,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');
  const raw = stripJsonFences(textBlock.text);
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    console.error('[prompts] JSON parse failed. Raw:', textBlock.text.substring(0, 500));
    throw new Error(`JSON parse: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
  }
  // @ts-ignore - runtime safety check
  parsed = parsed as { briefs: CompositionBrief[] };
  return parsed.briefs;
}

// ---------------------------------------------------------------------------
// Template selection — Claude picks 3 templates + writes hook copy per variant
// ---------------------------------------------------------------------------

export type TemplateSelection = {
  variant_index: number;
  template_id: TemplateId;
  lockup: LockupLine[];
  palette: string[];
  frame_indices: number[];
  background_concept: string;  // Claude's short description of the thematic scene
  background_prompt: string | null;   // the full Flux-ready prompt; null = use algorithmic bg
  reasoning: string;
};



// ---------------------------------------------------------------------------
// Post-validation helpers for template selection
// ---------------------------------------------------------------------------

function normalizeTitle(title: string, maxWords: number = 5): string {
  const cleaned = title.replace(/[.!?]+$/g, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return cleaned.toUpperCase();
  // If too long, keep the first maxWords words
  return words.slice(0, maxWords).join(' ').toUpperCase();
}

function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  // Relative luminance per WCAG
  const rs = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const gs = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const bs = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = hexLuminance(hex1);
  const l2 = hexLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Templates that use thin/cursive script fonts as primary — need higher contrast
const SCRIPT_PRIMARY_TEMPLATES = new Set<string>([
  'cursive-elegance',     // Pinyon Script
  'romantic-script',       // Sacramento
  'casual-handwritten-bold', // Caveat
  'pair-pose-script',      // Pinyon Script
  'neon-script',           // has script secondary but primary is bowlby
  'script-overlay',        // mix
]);

function enforcePaletteContrast(palette: string[], templateId?: string): string[] {
  // Palette order: [text_fill, text_outline, bg_primary, bg_accent]
  const [textFill, , bgPrimary, bgAccent] = palette;

  // STRICT RULE: text_fill must be from the "punchy" allowlist.
  // No muted/dark shades, no background-matched colors. Always something that screams.
  const PUNCHY_FILLS: Record<string, string> = {
    white: '#FFFFFF',
    black: '#000000',
    yellow: '#FFEB3B',
    'gold-yellow': '#FFC107',
    orange: '#FF6B00',
    red: '#FF1744',
    crimson: '#DC143C',
    'hot-pink': '#FF1493',
    magenta: '#FF00FF',
    cyan: '#00F5FF',
    'electric-blue': '#1E90FF',
    'royal-blue': '#3F51FF',
    lime: '#39FF14',
    'neon-green': '#00FF88',
    'electric-purple': '#9D00FF',
  };

  const isScriptTemplate = !!(templateId && SCRIPT_PRIMARY_TEMPLATES.has(templateId));
  const minContrast = isScriptTemplate ? 5.0 : 3.5;

  let bestFill = '#FFFFFF';
  let bestContrast = 0;
  for (const candidate of Object.values(PUNCHY_FILLS)) {
    const c = contrastRatio(candidate, bgPrimary);
    if (c >= minContrast && c > bestContrast) {
      bestFill = candidate;
      bestContrast = c;
    }
  }

  // Preserve Claude's choice if it's already a punchy color with good contrast
  const claudeFillUpper = (textFill || '').toUpperCase();
  const allowed = Object.values(PUNCHY_FILLS).map((c) => c.toUpperCase());
  if (allowed.includes(claudeFillUpper) && contrastRatio(textFill, bgPrimary) >= minContrast) {
    bestFill = textFill;
  }

  // Outline: black for everything EXCEPT black fills, which get white outline.
  // This guarantees fill+outline always contrast, even when fill is black.
  const outline = bestFill.toUpperCase() === '#000000' ? '#FFFFFF' : '#000000';

  return [bestFill, outline, bgPrimary, bgAccent];
}

function postProcessSelections(
  selections: TemplateSelection[],
  brandPrimary: string,
  brandAccent: string,
): TemplateSelection[] {
  if (selections.length === 0) return selections;


  // Soft variety check: if references suggest the user wants a wider mix,
  // we still nudge toward 1 from each category, but only if Claude picked
  // 4+ from the same category (a "monoculture" pick).
  if (selections.length === 6) {
    const SCRIPT_TEMPLATES: TemplateId[] = ['cursive-elegance', 'romantic-script', 'casual-handwritten-bold', 'neon-script', 'script-overlay', 'handwritten-casual', 'pair-pose-script'];
    const GLAM_TEMPLATES: TemplateId[] = ['glam-serif', 'cute-bubble', 'disco-retro', 'pair-pose-bold'];
    const BLOCK_TEMPLATES: TemplateId[] = ['big-block', 'hero-pose', 'slab-menace', 'crossed-layered'];

    const has = (cat: TemplateId[]) => selections.some((s) => cat.includes(s.template_id));
    const hasScript = has(SCRIPT_TEMPLATES);
    const hasGlam = has(GLAM_TEMPLATES);
    const hasBlock = has(BLOCK_TEMPLATES);

    const usedIds = new Set(selections.map((s) => s.template_id));

    // Helper: find first non-mandatory variant that we can overwrite
    const findSwapCandidate = (preferredCats: TemplateId[][]): number => {
      for (let i = 0; i < selections.length; i++) {
        const id = selections[i].template_id;
        // Don't swap variants whose template is already in a "needed" category
        const inNeededCat = preferredCats.some((c) => c.includes(id));
        if (!inNeededCat) return i;
      }
      return 0; // Last resort: overwrite first
    };

    const pickFromCategory = (cat: TemplateId[]): TemplateId | null => {
      const available = cat.filter((id) => !usedIds.has(id));
      return available[0] || cat[0] || null;
    };

    if (!hasScript) {
      const newId = pickFromCategory(SCRIPT_TEMPLATES);
      if (newId) {
        const idx = findSwapCandidate([SCRIPT_TEMPLATES, GLAM_TEMPLATES, BLOCK_TEMPLATES]);
        console.log(`[postProcess] Forcing SCRIPT category: variant ${idx + 1} ${selections[idx].template_id} -> ${newId}`);
        usedIds.delete(selections[idx].template_id);
        selections[idx].template_id = newId;
        usedIds.add(newId);
      }
    }

    if (!hasGlam) {
      const newId = pickFromCategory(GLAM_TEMPLATES);
      if (newId) {
        const idx = findSwapCandidate([SCRIPT_TEMPLATES, GLAM_TEMPLATES, BLOCK_TEMPLATES]);
        console.log(`[postProcess] Forcing GLAM category: variant ${idx + 1} ${selections[idx].template_id} -> ${newId}`);
        usedIds.delete(selections[idx].template_id);
        selections[idx].template_id = newId;
        usedIds.add(newId);
      }
    }

    if (!hasBlock) {
      const newId = pickFromCategory(BLOCK_TEMPLATES);
      if (newId) {
        const idx = findSwapCandidate([SCRIPT_TEMPLATES, GLAM_TEMPLATES, BLOCK_TEMPLATES]);
        console.log(`[postProcess] Forcing BLOCK category: variant ${idx + 1} ${selections[idx].template_id} -> ${newId}`);
        usedIds.delete(selections[idx].template_id);
        selections[idx].template_id = newId;
        usedIds.add(newId);
      }
    }
  }

  // Enforce 3+3 thematic/simple split for 6-variant batches
  // Visual-complexity classifier — matches on prompt content, not just the literal word "simple".
  // A "soft pink gradient with bokeh" reads as visually simple even when the concept doesn't say so.
  const SIMPLE_BG_SIGNALS = [
    'simple', 'gradient', 'flat', 'solid', 'bokeh', 'soft', 'blur', 'blurred',
    'minimal', 'studio', 'clean', 'plain', 'monochrome', 'spiral', 'algorithmic',
  ];
  const isVisuallySimple = (s: TemplateSelection): boolean => {
    if (!s.background_prompt || s.background_prompt.trim().length === 0) return true;
    const haystack = ((s.background_concept || '') + ' ' + (s.background_prompt || '')).toLowerCase();
    // Strong signal: the prompt is mostly about lighting/color, not scene
    return SIMPLE_BG_SIGNALS.some((sig) => haystack.includes(sig));
  };

  if (selections.length === 6) {
    const thematicIndices: number[] = [];
    const simpleIndices: number[] = [];
    selections.forEach((s, i) => {
      if (isVisuallySimple(s)) simpleIndices.push(i);
      else thematicIndices.push(i);
    });

    // If we have too many thematic, force the LAST ones to be simple
    while (thematicIndices.length > 3) {
      const lastThematic = thematicIndices.pop()!;
      simpleIndices.push(lastThematic);
      selections[lastThematic].background_concept = 'simple';
      selections[lastThematic].background_prompt = '';
    }
    // If we have too many simple, unfortunately we can't invent thematic prompts — log a warning but accept
    if (thematicIndices.length < 3) {
      console.warn(`[postProcess] Only ${thematicIndices.length} thematic variants (expected 3). Accepting as-is.`);
    }
  }

  return selections.map((s) => ({
    ...s,
    // Each variant keeps its own lockup — Claude tunes typography to each
    // template + layout + mood. References show this produces higher-quality output
    // than forcing a single canonical lockup across all 6 variants.
    lockup: s.lockup,
    // Force brand colors into bg slots — Claude only controls text fill + outline
    palette: enforcePaletteContrast([
      s.palette[0] || '#FFFFFF',  // text_fill (Claude's choice)
      s.palette[1] || '#000000',  // text_outline (Claude's choice)
      brandPrimary,                // bg_primary FORCED to brand
      brandAccent,                 // bg_accent FORCED to brand
    ], s.template_id),
    background_concept: s.background_concept || 'simple',
    // Pass null for visually-simple bgs (algorithmic rendering); pass the Flux prompt for thematic.
    // Uses the same isVisuallySimple helper as the diversity check above for consistency.
    background_prompt: isVisuallySimple(s) ? null : s.background_prompt,
  }));
}

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

  console.log(`[selectTemplatesForClip] Loaded ${styleExamples.length} thumbnail style examples and ${descriptionExamples.length} description examples`);
  if (styleExamples.length > 0) {
    content.push({
      type: 'text',
      text: `THIS CREATOR'S BRAND VOICE — STUDY THESE THUMBNAILS CAREFULLY.

The following ${styleExamples.length} thumbnails define this creator's signature visual language. Your goal is to capture the SAME aesthetic energy, color palettes, and typographic choices when picking templates and writing palettes for the new clip.

Pay close attention to:
- **Typography style**: Are most titles in chunky sans, elegant serifs, flowing scripts, or playful bubble fonts? Match that energy.
- **Color palette**: What 2-3 colors dominate? Use them as your bg_primary/bg_accent in most variants.
- **Mood**: Glamorous? Aggressive? Playful? Angelic? Mocking? Capture this in your background concepts.
- **Composition style**: Single-figure dominant? Pair/multi-figure? Layered? Use this as your layout signal.

Your 6 variants for the new clip should feel like NEW additions to this same brand library. Not generic templates — pieces that belong with these.`,
    });
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

TASK: Select 6 DIFFERENT templates for this clip and design the LOCKUP + palette + background for each.

RULES:

1. **Six DIFFERENT templates that CAPTURE THE BRAND'S VISUAL LANGUAGE (priority #1).**
   First and foremost: study the reference thumbnails above. Pick 6 different template_ids whose layouts best match the brand's established visual signature.
   - If references show pair-close layouts a lot, use pair-close more
   - If single-figure dominates, lean single
   - Don't force layout variety against brand voice

2. **LOCKUP — typography is now a stack of styled lines.**
   Each variant returns a "lockup" array of 1-5 lines (1-2 is most common, 3 is dramatic, 4-5 is RARE).
   Each line picks its OWN font, size, fill color, outline color, italic, shadow, glow, rotation.

   The lockup REPLACES the old text_primary/text_secondary fields entirely. Do not return text_primary or text_secondary — only return "lockup" as an array.

   AVAILABLE FONTS (FontKey values you may use):
   - Heavy display: 'anton', 'bebas-neue', 'bowlby-one', 'fredoka-one', 'alfa-slab-one', 'rubik-mono-one', 'passion-one', 'abril-fatface', 'monoton'
   - Heavy sans-black: 'montserrat-black'
   - Elegant serif: 'playfair-display-black', 'yeseva-one'
   - Script (use sparingly, larger size, thicker outline, italic:true): 'dancing-script', 'pacifico', 'pinyon-script', 'sacramento', 'caveat'
   - Tech/futuristic: 'orbitron'
   - Handwritten/marker: 'permanent-marker'

   LOCKUP DESIGN RULES:
   - 1-2 lines is default. Use 3 only when you have primary + accent + tag structure.
   - Sum of size_pct across all lines should be 0.20-0.45 (lockup fills 20-45% of vertical canvas).
   - The BIGGEST line is the hook. Smaller lines support it.
   - Mix styles for contrast: heavy display + script accent, or all-caps display + italicized rejoinder.
   - ALL CAPS for display fonts. Mixed case OK for scripts and serifs.
   - fill is from the punchy palette: white #FFFFFF, yellow #FFEB3B, gold-yellow #FFC107, orange #FF6B00, red #FF1744, crimson #DC143C, hot-pink #FF1493, magenta #FF00FF, cyan #00F5FF, electric-blue #1E90FF, royal-blue #3F51FF, lime #39FF14, neon-green #00FF88, electric-purple #9D00FF, or black #000000.
   - outline_color is almost always #000000 (black). For black fills use #FFFFFF (white) outline.
   - rotation_deg between -8 and 8 for accent/script lines that should feel scrawled or stamped.
   - fill_box is optional — a colored rectangle BEHIND a single accent word (signature element). Use it on at most ONE line per lockup. Pink (#FF1493), red (#FF1744), or hot magenta (#FF00FF) are classic box colors.

   Lockup examples (these mirror real high-performing creator thumbnails):
   * "Locked Up & Ruined" — heavy display + script accent:
     [{"text":"LOCKED UP","font":"bowlby-one","size_pct":0.20,"fill":"#FFFFFF","outline_color":"#000000"},
      {"text":"& Ruined","font":"pinyon-script","size_pct":0.16,"fill":"#FF1493","outline_color":"#000000","italic":true,"rotation_deg":-3}]
   * "Born Again Virgin" — display word + tagged accent box:
     [{"text":"BORN AGAIN","font":"anton","size_pct":0.22,"fill":"#FFFFFF","outline_color":"#000000"},
      {"text":"VIRGIN","font":"anton","size_pct":0.13,"fill":"#FFFFFF","outline_color":"#FF1493","rotation_deg":-3,"fill_box":{"color":"#FF1493","padding_x_pct":0.30,"padding_y_pct":0.12,"rotation_deg":-3}}]
   * "Goddess of Gooning" — three-line vertical stack:
     [{"text":"GODDESS","font":"playfair-display-black","size_pct":0.18,"fill":"#FFEB3B","outline_color":"#000000"},
      {"text":"OF","font":"playfair-display-black","size_pct":0.10,"fill":"#FFEB3B","outline_color":"#000000"},
      {"text":"GOONING","font":"playfair-display-black","size_pct":0.18,"fill":"#FFEB3B","outline_color":"#000000"}]
   * "Trying Not to Relapse?" — stacked display + box-tagged accent:
     [{"text":"TRYING","font":"anton","size_pct":0.16,"fill":"#FFFFFF","outline_color":"#000000"},
      {"text":"NOT TO","font":"anton","size_pct":0.10,"fill":"#FFFFFF","outline_color":"#000000"},
      {"text":"RELAPSE?","font":"anton","size_pct":0.16,"fill":"#FFFFFF","outline_color":"#000000","fill_box":{"color":"#FF1744"}}]
   * "Princess Mindfuck" — display + flowing script:
     [{"text":"PRINCESS","font":"montserrat-black","size_pct":0.13,"fill":"#FFFFFF","outline_color":"#000000"},
      {"text":"Mindfuck","font":"sacramento","size_pct":0.20,"fill":"#FFEB3B","outline_color":"#000000","italic":true}]
   * Single-line bold (when copy is one strong word):
     [{"text":"OBEY","font":"anton","size_pct":0.30,"fill":"#FFFFFF","outline_color":"#000000"}]

   COPY RULES:
   - 1-4 words per line, 5 max. Punchy, hot, in the creator's voice.
   - Each variant different angle: command / tease / consequence
   - The lockup IS the title, broken into styled stack pieces. If clip title is "Chastity Task", a 1-line lockup might be [{"text":"CHASTITY TASK", font:"anton", size_pct:0.22, ...}]; a 2-line lockup might split it into [{"text":"CHASTITY"...},{"text":"TASK"...}] with different fonts/colors.
   - Each variant should have its OWN lockup design — Claude tunes typography to each template + layout + mood.

3. **Frames:** for templates needing multiple frames (triple-diff, split-diff, pair-close), use DIFFERENT frame indices (0, 1, 2).

4. **Palette — MUST POP.**
   - 4 hex colors in order: [text_fill, text_outline, bg_primary, bg_accent]
   - text_fill: bright punchy color (white, hot pink, yellow, cyan). NEVER same hue as bg.
   - text_outline: BLACK (#000000) 90% of the time. White (#FFFFFF) only when text_fill is black.
   - bg_primary, bg_accent: brand colors (${primary}, ${accent}) or template's default_palette.
   - Note: the lockup itself carries per-line colors. The palette here is for system-level palette validation; bg_primary/bg_accent set the variant's BACKGROUND.

5. **Background concept — MIX STYLES ACROSS THE 6 VARIANTS.**
   **CRITICAL MIX RULE (WILL BE VALIDATED):** Across the 6 variants, EXACTLY 3 MUST be "thematic scenes" (AI-generated environments with a real Flux prompt) and EXACTLY 3 MUST be "simple" (flat/gradient/spiral — algorithmic, no AI).

   To comply: mark exactly 3 variants as "simple" (background_concept='simple', background_prompt=null) and exactly 3 as thematic (with real scene prompts).

   **THE MODEL ALWAYS POPS — figure-environment awareness:**
   Before assigning a thematic background to a variant, study its source frame. The figure already brings its own visual environment with it (bedroom set, on-location backdrop, studio walls, props, complex lighting). The bg layer and the figure's surroundings together determine how busy the thumbnail feels.

   - **Frame has a busy/themed environment already** (visible bedroom, on-location, ornate props, dramatic colored lighting): assign this variant a SIMPLE bg. The figure's own context carries the theme; a thematic bg layer would compete with it and make the model harder to see.
   - **Frame is clean/studio/neutral** (plain backdrop, soft single-color lighting, minimal context): the bg layer can do more visual work. Assign thematic if the clip warrants it.

   When in doubt, default toward simple. The model is the visual focus on every variant. Backgrounds support, never compete.

   **Rules for thematic variants:**
   - Match emotional vibe of the clip (tags, title, description)
   - Examples: hypno → "heavenly cloud dreamscape" / chastity → "royal throne room velvet" / tease → "moonlit silk bedroom" / humiliation → "neon lit club interior" / angel → "heavenly clouds golden sunlight"
   - Reserve elaborate themed scenes for clips whose tags or title genuinely call for one. A generic untagged clip rarely needs three full themed scenes — when uncertain, the busiest of the three thematic slots can be a softer "simple-thematic" (e.g. "soft pink gradient with bokeh", "monochrome purple atmospheric") rather than a full environment.

   **Rules for background_prompt (Flux-ready):**
   - DESCRIBE THE SCENE ONLY. No people. No kink objects. No text. No watermarks.
   - Include mood lighting, atmosphere, color palette.
   - Keep it PG-13 — must pass content safety filter.

6. **Reasoning:** 1 sentence per variant explaining why this template + lockup + palette + background fits.

Return ONLY valid JSON. Start with { and end with }. No prose, no explanation, no markdown code fences, no additional text before or after:

{
  "selections": [
    {
      "variant_index": 1,
      "template_id": "<one of the template ids>",
      "lockup": [
        {"text":"<words>","font":"<FontKey>","size_pct":0.22,"fill":"#hex","outline_color":"#000000"}
      ],
      "palette": ["#text_fill", "#text_outline", "#bg_primary", "#bg_accent"],
      "frame_indices": [<0|1|2>, ...],
      "background_concept": "<2-5 words OR 'simple'>",
      "background_prompt": "<1-2 sentences Flux prompt for thematic, OR null for simple>",
      "reasoning": "<1 sentence why this template + lockup fits this clip>"
    }
  ]
}`,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 6144,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text from Claude');
  const raw = stripJsonFences(textBlock.text);
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    console.error('[prompts] JSON parse failed. Raw:', textBlock.text.substring(0, 500));
    throw new Error(`JSON parse: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
  }
  // @ts-ignore - runtime safety check
  parsed = parsed as { selections: TemplateSelection[] };
  console.log('[selectTemplatesForClip] Claude picked these template_ids:', parsed.selections.map((s: any) => s.template_id));
  const processed = postProcessSelections(parsed.selections, primary, accent);
  console.log('[selectTemplatesForClip] After postProcess:', processed.map((s) => s.template_id));
  return processed;
}

