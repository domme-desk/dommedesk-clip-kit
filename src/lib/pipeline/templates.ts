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
  | 'neon-glow';

export type LayoutType = 'single' | 'mirror' | 'triple-diff' | 'split-diff';

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
