/**
 * Template library — v1 (10 templates)
 *
 * Each template is a declarative recipe for rendering a thumbnail.
 * Claude picks 3 templates per clip; the renderer executes them.
 */

import type { FontKey } from './fonts';

export type TemplateId =
  | 'big-block'
  | 'neon-script'
  | 'split-photo'
  | 'triple-pose'
  | 'mirror-double'
  | 'hero-pose'
  | 'crossed-layered'
  | 'cute-bubble'
  | 'hypno-spiral'
  | 'neon-glow'
  | 'glam-serif'
  | 'disco-retro'
  | 'script-overlay'
  | 'slab-menace'
  | 'handwritten-casual'
  | 'cursive-elegance'
  | 'romantic-script'
  | 'casual-handwritten-bold'
  | 'pair-pose-script'
  | 'pair-pose-bold';

export type LayoutType = 'single' | 'mirror' | 'triple-diff' | 'split-diff' | 'pair-close';

export type BackgroundStyle =
  | 'flat-saturated'
  | 'gradient'
  | 'dark-moody-bokeh'
  | 'bright-abstract'
  | 'spiral-radial'
  | 'environmental-bokeh'
  | 'dark-texture'
  | 'pastel-bright'
  | 'deep-neon';

export type TextEffect =
  | 'heavy-outline-shadow'
  | 'neon-glow'
  | 'clean-outline'
  | 'layered-multi'
  | 'elegant-drop-shadow'
  | 'bubble-thick-rounded'
  | 'chromatic-aberration'
  | 'glow-transparent';

export type TemplateSpec = {
  id: TemplateId;
  name: string;
  feel: string;
  layout: LayoutType;
  frames_needed: 1 | 2 | 3;
  primary_font: FontKey;
  secondary_font?: FontKey;
  background: BackgroundStyle;
  text_effect: TextEffect;
  default_palette: string[];
  best_for_tags: string[];
  text_primary_max_words: number;
  supports_secondary_text: boolean;
  claude_guidance: string;
};

export const TEMPLATES: Record<TemplateId, TemplateSpec> = {
  'big-block': {
    id: 'big-block',
    name: 'Big Block',
    feel: 'aggressive, commanding, dominant',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'anton',
    background: 'flat-saturated',
    text_effect: 'heavy-outline-shadow',
    default_palette: ['#FF1493', '#E63946', '#9D4EDD', '#000000'],
    best_for_tags: ['command', 'dominant', 'humiliation', 'findom', 'tasks', 'orders'],
    text_primary_max_words: 4,
    supports_secondary_text: false,
    claude_guidance: 'Safe default. Works for commanding/dom clips. Heavy text dominates.',
  },
  'neon-script': {
    id: 'neon-script',
    name: 'Neon Script',
    feel: 'sensual, playful, high-end',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'bowlby-one',
    secondary_font: 'dancing-script',
    background: 'dark-moody-bokeh',
    text_effect: 'neon-glow',
    default_palette: ['#FF1493', '#FF69B4', '#9D4EDD', '#FFFFFF'],
    best_for_tags: ['tease', 'sensual', 'goddess', 'worship'],
    text_primary_max_words: 3,
    supports_secondary_text: true,
    claude_guidance: 'Use when clip is tease/goddess/sensual. Primary is short hook, secondary is a script word like Remember or Forever.',
  },
  'split-photo': {
    id: 'split-photo',
    name: 'Split Photo',
    feel: 'contrast, before/after, duality',
    layout: 'split-diff',
    frames_needed: 2,
    primary_font: 'montserrat-black',
    background: 'gradient',
    text_effect: 'clean-outline',
    default_palette: ['#FF1493', '#9D4EDD', '#FFFFFF'],
    best_for_tags: ['challenge', 'transformation', 'before-after', 'contrast'],
    text_primary_max_words: 5,
    supports_secondary_text: false,
    claude_guidance: 'Use when clip has two contrasting moments or a transformation concept.',
  },
  'triple-pose': {
    id: 'triple-pose',
    name: 'Triple Pose',
    feel: 'dynamic, busy, high energy',
    layout: 'triple-diff',
    frames_needed: 3,
    primary_font: 'bowlby-one',
    secondary_font: 'pacifico',
    background: 'bright-abstract',
    text_effect: 'bubble-thick-rounded',
    default_palette: ['#FF1493', '#E63946', '#FFD700', '#FFFFFF'],
    best_for_tags: ['bratty', 'playful', 'tease', 'JOI', 'CEI'],
    text_primary_max_words: 3,
    supports_secondary_text: true,
    claude_guidance: 'Use when clip has multiple moments/energy. Three DIFFERENT poses composited.',
  },
  'mirror-double': {
    id: 'mirror-double',
    name: 'Mirror Double',
    feel: 'symmetric, hypnotic, dramatic',
    layout: 'mirror',
    frames_needed: 1,
    primary_font: 'anton',
    background: 'spiral-radial',
    text_effect: 'layered-multi',
    default_palette: ['#FFD700', '#FF1493', '#000000', '#FFFFFF'],
    best_for_tags: ['hypno', 'mindfuck', 'control', 'mesmer', 'goon'],
    text_primary_max_words: 4,
    supports_secondary_text: false,
    claude_guidance: 'Perfect for hypno/mindfuck/goon clips where symmetry reinforces the trance theme.',
  },
  'hero-pose': {
    id: 'hero-pose',
    name: 'Hero Pose',
    feel: 'cinematic, editorial, polished',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'playfair-display-black',
    secondary_font: 'dancing-script',
    background: 'environmental-bokeh',
    text_effect: 'elegant-drop-shadow',
    default_palette: ['#FFFFFF', '#FF69B4', '#F4A261', '#000000'],
    best_for_tags: ['lingerie', 'luxury', 'sensual', 'reveal'],
    text_primary_max_words: 4,
    supports_secondary_text: true,
    claude_guidance: 'Classy cinematic feel. Best for clips showcasing outfit/body, luxury dom branding.',
  },
  'crossed-layered': {
    id: 'crossed-layered',
    name: 'Crossed Layered',
    feel: 'edgy, seductive, intricate',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'montserrat-black',
    secondary_font: 'permanent-marker',
    background: 'dark-texture',
    text_effect: 'layered-multi',
    default_palette: ['#FF1493', '#FFFFFF', '#000000', '#E63946'],
    best_for_tags: ['capture', 'seduction', 'enslavement', 'trap'],
    text_primary_max_words: 4,
    supports_secondary_text: true,
    claude_guidance: 'Text cuts across subject. Good for seduction/capture narrative clips.',
  },
  'cute-bubble': {
    id: 'cute-bubble',
    name: 'Cute Bubble',
    feel: 'bratty, playful, pop',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'fredoka-one',
    background: 'pastel-bright',
    text_effect: 'bubble-thick-rounded',
    default_palette: ['#FF69B4', '#FFB3D9', '#FFD700', '#FFFFFF'],
    best_for_tags: ['humiliation', 'bratty', 'playful', 'SPH', 'loser'],
    text_primary_max_words: 3,
    supports_secondary_text: false,
    claude_guidance: 'Bratty/humiliation/SPH clips. Pastel pink dominant. Feels playful not menacing.',
  },
  'hypno-spiral': {
    id: 'hypno-spiral',
    name: 'Hypno Spiral',
    feel: 'trance, control, hypnotic',
    layout: 'mirror',
    frames_needed: 1,
    primary_font: 'anton',
    background: 'spiral-radial',
    text_effect: 'chromatic-aberration',
    default_palette: ['#000000', '#FFFFFF', '#FF1493'],
    best_for_tags: ['hypno', 'mesmer', 'goon', 'trance', 'mind-control'],
    text_primary_max_words: 4,
    supports_secondary_text: false,
    claude_guidance: 'Pure hypno aesthetic. Spiral bg + chromatic text. Very distinctive, use sparingly.',
  },
  'neon-glow': {
    id: 'neon-glow',
    name: 'Neon Glow',
    feel: 'late-night, intimate, atmospheric',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'orbitron',
    background: 'deep-neon',
    text_effect: 'glow-transparent',
    default_palette: ['#FF1493', '#9D4EDD', '#00F5FF', '#FFFFFF'],
    best_for_tags: ['intimate', 'sensual', 'moody', 'nighttime'],
    text_primary_max_words: 4,
    supports_secondary_text: false,
    claude_guidance: 'Moody late-night vibe. Use when description tone is intimate/quiet/slow.',
  },
  'glam-serif': {
    id: 'glam-serif',
    name: 'Glam Serif',
    feel: 'high-end editorial, feminine luxury',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'abril-fatface',
    secondary_font: 'playfair-display-italic',
    background: 'environmental-bokeh',
    text_effect: 'elegant-drop-shadow',
    default_palette: ['#FFFFFF', '#000000', '#FF1493', '#2D0A3D'],
    best_for_tags: ['luxury', 'glamour', 'editorial', 'lingerie', 'findom', 'goddess'],
    text_primary_max_words: 4,
    supports_secondary_text: true,
    claude_guidance: 'Editorial luxury look. Thick italic serif primary. For lingerie reveals or goddess/femdom luxury branding.',
  },
  'disco-retro': {
    id: 'disco-retro',
    name: 'Disco Retro',
    feel: 'retro 70s/80s, glamorous vintage',
    layout: 'mirror',
    frames_needed: 1,
    primary_font: 'monoton',
    background: 'gradient',
    text_effect: 'layered-multi',
    default_palette: ['#FFD700', '#FF1493', '#2D0A3D', '#9D4EDD'],
    best_for_tags: ['disco', 'retro', 'party', 'vintage', 'nostalgia', 'showgirl'],
    text_primary_max_words: 3,
    supports_secondary_text: false,
    claude_guidance: 'Monoton vertical-stripe font with retro gradient. Best for playful vintage-vibe clips.',
  },
  'cursive-elegance': {
    id: 'cursive-elegance',
    name: 'Cursive Elegance',
    feel: 'flowing romantic script as the dominant title',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'pinyon-script',
    background: 'environmental-bokeh',
    text_effect: 'elegant-drop-shadow',
    default_palette: ['#FFD700', '#000000', '#FF1493', '#9D4EDD'],
    best_for_tags: ['princess', 'goddess', 'angelic', 'luxury', 'elegant', 'tease'],
    text_primary_max_words: 4,
    supports_secondary_text: false,
    claude_guidance: 'Pinyon Script as the BIG flowing main title. Looks like a luxury wedding invitation. Use for goddess/princess/angelic clip themes.',
  },
  'romantic-script': {
    id: 'romantic-script',
    name: 'Romantic Script',
    feel: 'sweeping cursive that fills the canvas',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'sacramento',
    background: 'pastel-bright',
    text_effect: 'elegant-drop-shadow',
    default_palette: ['#FFFFFF', '#FF1493', '#FFB3D9', '#FF69B4'],
    best_for_tags: ['intimate', 'gfe', 'romantic', 'sensual', 'tease', 'sweet'],
    text_primary_max_words: 4,
    supports_secondary_text: false,
    claude_guidance: 'Sacramento cursive as the BIG flowing main title. Hand-lettered romantic feel. Use for GFE/intimate/sensual clips.',
  },
  'casual-handwritten-bold': {
    id: 'casual-handwritten-bold',
    name: 'Casual Handwritten Bold',
    feel: 'energetic personal handwriting as title',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'caveat',
    background: 'flat-saturated',
    text_effect: 'heavy-outline-shadow',
    default_palette: ['#FFFFFF', '#000000', '#FF1493', '#9D4EDD'],
    best_for_tags: ['playful', 'brat', 'tease', 'flirty', 'casual', 'gfe'],
    text_primary_max_words: 5,
    supports_secondary_text: false,
    claude_guidance: 'Caveat hand-written as the BIG main title with heavy outline so it pops. Energetic playful feel. Use for brat/flirty/playful clips.',
  },
  'pair-pose-script': {
    id: 'pair-pose-script',
    name: 'Pair Pose Script',
    feel: 'two angles of you with elegant script title woven between',
    layout: 'pair-close',
    frames_needed: 2,
    primary_font: 'pinyon-script',
    background: 'environmental-bokeh',
    text_effect: 'elegant-drop-shadow',
    default_palette: ['#FFD700', '#000000', '#FF1493', '#9D4EDD'],
    best_for_tags: ['princess', 'goddess', 'angelic', 'tease', 'sensual', 'goon', 'mindfuck', 'hypno'],
    text_primary_max_words: 4,
    supports_secondary_text: false,
    claude_guidance: 'Two-pose pair composition. Pinyon Script as flowing main title centered between the two figures. Use for goddess/princess/mindfuck themes that imply duality.',
  },
  'pair-pose-bold': {
    id: 'pair-pose-bold',
    name: 'Pair Pose Bold',
    feel: 'two angles of you with chunky bubble title in the middle',
    layout: 'pair-close',
    frames_needed: 2,
    primary_font: 'fredoka-one',
    background: 'flat-saturated',
    text_effect: 'bubble-thick-rounded',
    default_palette: ['#FFFFFF', '#000000', '#FF1493', '#9D4EDD'],
    best_for_tags: ['playful', 'tease', 'brat', 'flirty', 'fun', 'duality', 'twins'],
    text_primary_max_words: 4,
    supports_secondary_text: false,
    claude_guidance: 'Two-pose pair composition with chunky Fredoka One bubble text centered between the figures. Energetic playful feel.',
  },


  'script-overlay': {
    id: 'script-overlay',
    name: 'Script Overlay',
    feel: 'layered emotional, sensual cascade',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'bowlby-one',
    secondary_font: 'pinyon-script',
    background: 'dark-moody-bokeh',
    text_effect: 'neon-glow',
    default_palette: ['#FFFFFF', '#000000', '#FF1493', '#9D4EDD'],
    best_for_tags: ['emotional', 'sensual', 'tease', 'worship', 'orgasm', 'ruined'],
    text_primary_max_words: 3,
    supports_secondary_text: true,
    claude_guidance: 'Chunky primary with flowing script accent underneath. Sensual emotional clips.',
  },
  'slab-menace': {
    id: 'slab-menace',
    name: 'Slab Menace',
    feel: 'aggressive, threatening, dominant',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'alfa-slab-one',
    background: 'dark-texture',
    text_effect: 'heavy-outline-shadow',
    default_palette: ['#FFEB3B', '#000000', '#E63946', '#1A0000'],
    best_for_tags: ['punishment', 'threat', 'degradation', 'harsh', 'findom', 'mean'],
    text_primary_max_words: 4,
    supports_secondary_text: false,
    claude_guidance: 'Heavy slab serif on dark aggressive bg. For mean/harsh/punishment clips. Yellow text on red-black pops.',
  },
  'handwritten-casual': {
    id: 'handwritten-casual',
    name: 'Handwritten Casual',
    feel: 'intimate, personal, friendly-teasing',
    layout: 'single',
    frames_needed: 1,
    primary_font: 'caveat',
    secondary_font: 'sacramento',
    background: 'pastel-bright',
    text_effect: 'clean-outline',
    default_palette: ['#FFFFFF', '#FF1493', '#FFB3D9', '#FF69B4'],
    best_for_tags: ['intimate', 'personal', 'friendly', 'girlfriend', 'playful', 'brat'],
    text_primary_max_words: 5,
    supports_secondary_text: true,
    claude_guidance: 'Casual handwritten feel. Like a personal note. Best for GFE / playful / intimate tease clips.',
  },

};

export function listTemplates(): TemplateSpec[] {
  return Object.values(TEMPLATES);
}

export function getTemplate(id: TemplateId): TemplateSpec | null {
  return TEMPLATES[id] || null;
}

export function templatesForClaude(): string {
  return Object.values(TEMPLATES)
    .map((t) => `- ${t.id}: ${t.name} — ${t.feel}. Best for: ${t.best_for_tags.join(', ')}. Layout: ${t.layout} (${t.frames_needed} frame(s)). ${t.claude_guidance}`)
    .join('\n');
}
