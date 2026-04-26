import Anthropic from '@anthropic-ai/sdk';
import type { Clip, Model, StyleLibraryItem } from '@/lib/supabase/types';
import type { CompositionSpec } from './template-renderer';

// ---------------------------------------------------------------------------
// Aspirational reference set — the bar the Composer aims for.
// Hosted in Supabase 'assets' bucket at composer-references/.
// To update: re-run scripts/upload-composer-refs.ts with new files.
// ---------------------------------------------------------------------------
const ASPIRATIONAL_REFERENCES = [
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/An_Orgasm_to_Remember.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Armpit_Worship.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Born_Again_Virgin_TN.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Cost_of_Cumming_TN.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Girlcock.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Goddess_of_Gooning.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Hot_Girls_Dont_Want_You.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/How_fast_can_i_turn_you_gay.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Locked_up_and_ruined.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Loser_Position.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Obey_the_Screen_TN.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Our_Final_Goodbye_TN.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Penis_Fly_Trap_Tn.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Premie_Challenge_TN.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Princess_Mindfuck.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Slurp_it_up.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Swallow_it.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Too_Pathetic_to_Perfomr.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/Trying_not_to_replapes.png',
  'https://soyjteyvpykbbnljzuhe.supabase.co/storage/v1/object/public/assets/composer-references/warning_this_will_cause_damage.png',
];

const FONT_KEYS = [
  'anton', 'bebas-neue', 'montserrat-black', 'bowlby-one', 'fredoka-one',
  'dancing-script', 'pacifico', 'playfair-display-black', 'playfair-display-italic',
  'orbitron', 'permanent-marker', 'abril-fatface', 'monoton', 'yeseva-one',
  'alfa-slab-one', 'caveat', 'pinyon-script', 'rubik-mono-one', 'passion-one',
  'sacramento',
] as const;

const BRAND_FALLBACK_PRIMARY = '#FF1493';
const BRAND_FALLBACK_ACCENT = '#9D4EDD';

// ---------------------------------------------------------------------------
// composeVariantsForClip — single Anthropic vision call, returns 6 spec objects.
// Replaces selectTemplatesForClip for the new Composer pipeline.
// ---------------------------------------------------------------------------

export async function composeVariantsForClip(
  scoredFrames: { timestamp: number; url: string }[],
  clip: Pick<Clip, 'title' | 'description' | 'tags' | 'auto_description'>,
  model: Model,
  styleExamples: StyleLibraryItem[],
  _descriptionExamples: StyleLibraryItem[]
): Promise<CompositionSpec[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const colors = (model.brand_colors || {}) as Record<string, string>;
  const primary = colors.primary || BRAND_FALLBACK_PRIMARY;
  const accent = colors.accent || BRAND_FALLBACK_ACCENT;
  const secondary = colors.secondary || '#FFFFFF';

  const content: Anthropic.ContentBlockParam[] = [];

  // ---- Aspirational references ----
  content.push({
    type: 'text',
    text: [
      '# Aspirational reference set',
      '',
      'These ' + ASPIRATIONAL_REFERENCES.length + ' thumbnails represent the quality bar this product aims for. They demonstrate the range of compositions that work: hero-center figures with simple bgs, mirrored flanking figures, frame-saturated overlays, multi-pose layouts, and themed atmospheric scenes. Study them as a system.',
      '',
      'What they have in common (these are the rules):',
      '- The model is always the visual focus. Backgrounds support, never compete.',
      '- Typography is punchy and intentional — multiple fonts per lockup, color contrast, often italic accent lines or script flourishes',
      '- When backgrounds are simple, they are saturated single colors or soft gradients',
      '- When backgrounds are themed, they do not fight the figure — restrained palette, atmospheric, the figure stays foregrounded',
      '- Color palettes are tight: usually 2-3 dominant colors',
      '',
      'Look at them now:',
    ].join('\n'),
  });
  for (const url of ASPIRATIONAL_REFERENCES) {
    content.push({ type: 'image', source: { type: 'url', url } });
  }

  // ---- Creator's own style library ----
  if (styleExamples.length > 0) {
    content.push({
      type: 'text',
      text: [
        '',
        '# This creator\'s style library',
        '',
        'These ' + styleExamples.length + ' thumbnails are from this creator\'s own catalog. They define this specific creator\'s voice. The aspirational set above is the quality bar; this set is the brand voice. Match BOTH.',
      ].join('\n'),
    });
    for (const ex of styleExamples.slice(0, 8)) {
      content.push({ type: 'image', source: { type: 'url', url: ex.asset_url } });
    }
  }

  // ---- Source frames from this clip ----
  content.push({
    type: 'text',
    text: [
      '',
      '# Source frames from this clip',
      '',
      'Three frames extracted from the video. The figure in these frames is the model. You will compose 6 thumbnails using these frames (or bg-removed cutouts of the figure within them) as source material.',
    ].join('\n'),
  });
  for (let i = 0; i < scoredFrames.length; i++) {
    content.push({
      type: 'text',
      text: 'Frame ' + i + ' at ' + scoredFrames[i].timestamp.toFixed(1) + 's:',
    });
    content.push({ type: 'image', source: { type: 'url', url: scoredFrames[i].url } });
  }

  // ---- Clip metadata ----
  const tagsStr = (clip.tags || []).join(', ') || '(no tags)';
  const description = clip.description || clip.auto_description || '(no description)';
  content.push({
    type: 'text',
    text: [
      '',
      '# Clip metadata',
      '',
      'Title: ' + clip.title,
      'Tags: ' + tagsStr,
      'Description: ' + description,
    ].join('\n'),
  });

  // ---- Brand context ----
  const toneNotes = model.tone_notes || '(none specified)';
  const bannedWords = (model.banned_words || []).join(', ') || '(none)';
  const bannedThemes = (model.banned_themes || []).join(', ') || '(none)';
  content.push({
    type: 'text',
    text: [
      '',
      '# Brand context',
      '',
      'Brand colors: primary=' + primary + ', secondary=' + secondary + ', accent=' + accent,
      'Tone notes: ' + toneNotes,
      'Banned words: ' + bannedWords,
      'Banned themes: ' + bannedThemes,
      '',
      'When tone_notes is empty AND no strong directional signal exists in the style library, default to the established brand vibe of pink/purple/magenta with white or yellow text accents. That is this product\'s de facto brand voice and a safe fallback.',
    ].join('\n'),
  });

  // ---- Output schema and rules ----
  const fontKeysFormatted = FONT_KEYS.map((k) => '`' + k + '`').join(', ');

  content.push({
    type: 'text',
    text: [
      '',
      '# Your task',
      '',
      'Produce exactly 6 thumbnail composition specs for this clip. Each spec is one variant. The 6 must be genuinely different from each other in figure positioning OR background OR lockup approach (ideally all three).',
      '',
      '## Available primitives — these are the ONLY things the renderer can produce.',
      '',
      '### Figure roles',
      '- `hero` — dominant single figure, viewer\'s primary focus',
      '- `flank-left` — figure on the left side of a mirrored pair',
      '- `flank-right` — figure on the right side of a mirrored pair',
      '- `overlay` — tighter crop composited on top of the bg (Penis Fly Trap-style)',
      '- `background-frame` — original frame with figure used AS the background (paired with an overlay figure on top)',
      '',
      '### Figure crops',
      '- `frame` — original frame, no bg removal (typical for background-frame role)',
      '- `wide` — full body bg-removed cutout',
      '- `medium` — bg-removed, top 75% (waist-up)',
      '- `tight` — bg-removed, top 45% (head and shoulders)',
      '- `face` — bg-removed, top 28% (face only)',
      '',
      '### Background modes',
      '- `solid` — single color',
      '- `gradient` — 2-color linear gradient',
      '- `monochrome-saturated` — single dominant color with subtle radial light. The "ACHE for me" purple style. DEFAULT CHOICE for simple bgs.',
      '- `frame-saturated` — original frame color-shifted and blurred, with the figure overlay on top. The "Too Pathetic to Perform" technique.',
      '- `algorithmic-spiral` — procedural spiral pattern. Subtle (low opacity), supporting role. NOTE: not yet implemented in renderer; will fall back to monochrome-saturated. You can still output this; the system will substitute.',
      '- `algorithmic-halo` — procedural halo/radial pattern. Same status as spiral.',
      '- `themed-image` — Flux-generated themed scene. Use SPARINGLY. Only when the clip\'s title/tags genuinely call for a themed environment AND it will not compete with the figure. Most clips do NOT need this.',
      '',
      '### Fonts (use exact keys)',
      fontKeysFormatted,
      '',
      '## Hard rules',
      '1. The model is the visual focus on every variant. Backgrounds support, never compete.',
      '2. Algorithmic background opacity is HARD CAPPED at 0.4. The renderer will clamp anything higher. Do not waste a slot on opacity > 0.4.',
      '3. Each variant must be genuinely different from its siblings. Six near-identical variants is a failure.',
      '4. Lockup typography should vary across variants. Do not use the same font on every variant.',
      '5. `themed-image` mode is the most expensive both in cost and visual risk. Use at most 1-2 variants out of 6 with themed-image.',
      '6. `frame-saturated` is great for clips where the figure\'s environment in the source frame is itself part of the appeal.',
      '7. **TEXT MUST NOT OVERLAP FIGURES — DO THE MATH.** Before you write text_placement, compute each figure\'s rectangular bbox in canvas pct, then place the lockup in a region that does NOT intersect any figure bbox. The bbox math:',
      '   - Each figure has scale_pct (height as fraction of canvas). Width is roughly scale_pct * 0.55 (figures are taller than wide). For example, scale_pct: 0.85 -> bbox height: 0.85, bbox width: ~0.47.',
      '   - Figure bbox in canvas pct: left = position.x_pct - (width/2), right = position.x_pct + (width/2), top = position.y_pct - (height/2), bottom = position.y_pct + (height/2).',
      '   - The lockup bbox is also rectangular: width = max_width_pct, height ~= 0.30 (most lockups are 2-3 lines tall).',
      '   - The lockup bbox must NOT intersect any figure bbox. If your math says they would overlap, REPOSITION the lockup until they do not.',
      '',
      '   CONCRETE PATTERNS BY LAYOUT:',
      '   - Hero with figure on right (x_pct: 0.55-0.70, scale 0.85): figure occupies roughly x: 0.32-0.93. Place lockup in x: 0.04-0.32, anchor:start, max_width: 0.30. y_pct: 0.20-0.50.',
      '   - Hero with figure on left (x_pct: 0.30-0.45, scale 0.85): figure occupies roughly x: 0.07-0.68. Place lockup in x: 0.68-0.96, anchor:end, max_width: 0.30. y_pct: 0.20-0.50.',
      '   - Mirrored (figures at x: 0.18 and 0.82, scale 0.72): figures occupy outer thirds. Lockup goes in the TOP BAND (y_pct: 0.12, anchor:middle, max_width: 0.65) — there is clear space above their heads if scale_pct is <= 0.72. NOT between them, NOT bottom band.',
      '   - Background-frame + overlay: bg-frame fills canvas. Overlay figure is small + off-center. Place lockup in the corner OPPOSITE the overlay. Overlay top-right -> lockup bottom-left. Overlay bottom-right -> lockup top-left.',
      '',
      '   GUARDRAILS:',
      '   - The lockup center y_pct must be between 0.18 and 0.82 (otherwise it clips off canvas).',
      '   - For anchor:start, x_pct must be <= 0.95 - max_width_pct.',
      '   - For anchor:end, x_pct must be >= max_width_pct + 0.04.',
      '   - For anchor:middle, x_pct must be between max_width_pct/2 and 1 - max_width_pct/2.',
      '   - If you cannot find a non-overlapping zone with reasonable max_width_pct, REDUCE max_width_pct (smaller text) or REDUCE scale_pct (smaller figure) until it fits. The composition must work.',
      '',
      '## Spec format',
      '',
      'Return a single JSON object: { "compositions": [...6 spec objects...] }',
      '',
      'Each spec object has this exact shape:',
      '',
      '{',
      '  "reasoning": "1-2 sentences — why this composition for this clip + variant slot",',
      '  "figures": [',
      '    {',
      '      "role": "hero" | "flank-left" | "flank-right" | "overlay" | "background-frame",',
      '      "crop": "frame" | "wide" | "medium" | "tight" | "face",',
      '      "position": { "x_pct": <0.0-1.0>, "y_pct": <0.0-1.0> },',
      '      "scale_pct": <0.3-1.0>,',
      '      "mirrored": false,',
      '      "frame_index": <0|1|2>,',
      '      "treatment": {',
      '        "saturation": 1.0,',
      '        "brightness": 1.0,',
      '        "rim_light": "#hex" or null,',
      '        "glow": "#hex" or null',
      '      }',
      '    }',
      '  ],',
      '  "background": {',
      '    "mode": "<one of the bg modes>",',
      '    "colors": ["#hex", ...],',
      '    "gradient_angle_deg": <0-360>,',
      '    "frame_shift": { "hue_deg": <0-360>, "saturation": <0.5-2.5> },',
      '    "algorithmic": { "color": "#hex", "opacity": <0.0-0.4>, "scale": <0.5-2.0> },',
      '    "themed_prompt": "<Flux-ready scene description, only if mode is themed-image>"',
      '  },',
      '  "lockup": [',
      '    {',
      '      "text": "<short phrase, 1-4 words>",',
      '      "font": "<exact font key from list>",',
      '      "size_pct": <0.05-0.30>,',
      '      "fill": "#hex",',
      '      "outline_color": "#hex",',
      '      "italic": false,',
      '      "glow_color": "#hex" or null,',
      '      "rotation_deg": 0',
      '    }',
      '  ],',
      '  "text_placement": {',
      '    "x_pct": <0.0-1.0>,',
      '    "y_pct": <0.0-1.0>,',
      '    "anchor": "start" | "middle" | "end",',
      '    "max_width_pct": <0.0-1.0>',
      '  }',
      '}',
      '',
      'Lockup notes:',
      '- The lockup is an array of LINES. A 2-line lockup has 2 array entries. Each line has its own typography.',
      '- The lockup IS the title broken into styled stack pieces. For "Chastity Task" you might output [{text:"CHASTITY",font:"anton",size_pct:0.22,fill:"#FFFFFF"},{text:"Task",font:"sacramento",size_pct:0.18,fill:"#FFEB3B",italic:true}].',
      '- 1-4 words per line, 5 max.',
      '- Vary text content across the 6 variants — different angles, different hooks, different rephrasings of the title.',
      '- text_placement.x_pct/y_pct is the ANCHOR point of the lockup. max_width_pct constrains how wide the lockup can grow before lines wrap.',
      '',
      'Figure positioning notes:',
      '- position.x_pct, y_pct is the CENTER of the figure on canvas (0.5, 0.5 = dead center)',
      '- scale_pct is figure HEIGHT as fraction of canvas height',
      '- For hero-center compositions, position around { x_pct: 0.5-0.65, y_pct: 0.55 } with scale_pct around 0.85',
      '- For mirrored flanking, flank-left at { x_pct: 0.18, y_pct: 0.55 } and flank-right at { x_pct: 0.82, y_pct: 0.55 }, both around scale_pct 0.75',
      '- For overlay-on-frame: this is a TWO-MOMENT composition. The background-frame figure shows ONE pose and the overlay shows a DIFFERENT pose. They MUST use different frame_index values, otherwise the same face appears twice and looks weird. If you only have one good moment from this clip, do NOT use background-frame role — use `hero` with a themed-image bg instead.',
      '- background-frame figure: scale 1.0, position 0.5/0.5, frame_index N',
      '- overlay figure: scale 0.6-0.8, position off-center (e.g. 0.7/0.55), frame_index M (M must NOT equal N)',
      '',
      'frame_index notes:',
      '- frame_index tells the renderer which source frame (0/1/2) to use for this figure. Defaults to 0.',
      '- For multi-figure compositions where you want different poses (e.g. mirrored flanks showing two different expressions, or pair-close with two distinct moments), assign different frame_index values to each figure.',
      '- For background-frame + overlay compositions (Penis Fly Trap style), the background-frame figure and the overlay figure CAN use the same frame_index (same source, different treatment) OR different ones (background is moment A, overlay is moment B).',
      '- Keep frame_index in [0, 1, 2]. There are exactly 3 frames available.',
      '',
      'Output ONLY the JSON object. No prose, no markdown fences, no preamble. Start with { and end with }.',
    ].join('\n'),
  });

  // ---- Make the call ----
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8192,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Composer: no text block in response');
  }

  let raw = textBlock.text.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: { compositions: CompositionSpec[] };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[composeVariantsForClip] Failed to parse JSON. Raw response:');
    console.error(raw.slice(0, 1000));
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error('Composer JSON parse failed: ' + msg);
  }

  if (!parsed.compositions || !Array.isArray(parsed.compositions)) {
    throw new Error('Composer: response missing compositions array');
  }
  if (parsed.compositions.length !== 6) {
    console.warn('[composeVariantsForClip] Expected 6 compositions, got ' + parsed.compositions.length);
  }

  // Clamp algorithmic opacity to 0.4 as a safety net.
  for (const spec of parsed.compositions) {
    if (spec?.background?.algorithmic?.opacity !== undefined) {
      spec.background.algorithmic.opacity = Math.min(0.4, spec.background.algorithmic.opacity);
    }
  }

  // Validate each spec has the required structure. Replace any null/malformed
  // spec with a minimal fallback so the renderer never gets undefined input.
  const validated: CompositionSpec[] = parsed.compositions.map((spec, idx) => {
    const isValid = spec
      && Array.isArray(spec.figures)
      && spec.figures.length > 0
      && Array.isArray(spec.lockup)
      && spec.lockup.length > 0
      && spec.background?.mode
      && spec.text_placement;
    if (isValid) return spec;
    console.warn('[composeVariantsForClip] Spec ' + idx + ' is invalid, using fallback. Got:', JSON.stringify(spec)?.slice(0, 200));
    return {
      reasoning: 'Fallback: original Composer spec was invalid.',
      figures: [
        {
          role: 'hero',
          crop: 'medium',
          position: { x_pct: 0.55, y_pct: 0.55 },
          scale_pct: 0.85,
          mirrored: false,
          frame_index: 0,
          treatment: { saturation: 1.0, brightness: 1.0, rim_light: '#FF1493', glow: null },
        },
      ],
      background: {
        mode: 'monochrome-saturated',
        colors: ['#FF1493', '#9D4EDD'],
      },
      lockup: [
        { text: (clip.title || 'UNTITLED').toUpperCase().slice(0, 30), font: 'anton', size_pct: 0.20, fill: '#FFFFFF', outline_color: '#000000' },
      ],
      text_placement: { x_pct: 0.5, y_pct: 0.18, anchor: 'middle', max_width_pct: 0.85 },
    };
  });

  // Two-moment auto-correction: if a spec has both background-frame and overlay
  // figures with the same frame_index, bump the overlay's frame_index by 1 so
  // they show different moments. Composer doesn't reliably follow this rule
  // even when the prompt requires it.
  for (const spec of validated) {
    const bgFrame = spec.figures.find((f) => f.role === 'background-frame');
    const overlay = spec.figures.find((f) => f.role === 'overlay');
    if (bgFrame && overlay && (bgFrame.frame_index ?? 0) === (overlay.frame_index ?? 0)) {
      const newIdx = ((bgFrame.frame_index ?? 0) + 1) % 3;
      overlay.frame_index = newIdx;
      console.log('[composeVariantsForClip] Auto-corrected overlay frame_index to ' + newIdx + ' (was duplicate of background-frame)');
    }
  }

  console.log('[composeVariantsForClip] Generated ' + validated.length + ' compositions (' + (validated.length - parsed.compositions.filter((s: unknown) => s && (s as { figures?: unknown }).figures).length) + ' fallbacks)');
  return validated;
}
