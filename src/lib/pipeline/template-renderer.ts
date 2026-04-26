import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import sharp from 'sharp';
import { loadAllFonts, getFontFamily, type FontKey } from './fonts';
import { TEMPLATES, type TemplateId, type TemplateSpec, type BackgroundStyle, type TextEffect } from './templates';

// ---------------------------------------------------------------------------
// Canvas constants
// ---------------------------------------------------------------------------

export const CANVAS_W = 1280;


// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type TextPlacement = {
  x: number;
  y: number;
  maxWidth: number;
  anchor: 'start' | 'middle' | 'end';
  verticalAlign: 'top' | 'center' | 'bottom';
};

// ---------------------------------------------------------------------------
// Composer spec types — Claude outputs one of these per variant.
// The renderer (renderComposition) consumes them deterministically.
// ---------------------------------------------------------------------------

export type FigureRole = 'hero' | 'flank-left' | 'flank-right' | 'overlay' | 'background-frame';
export type FigureCrop = 'frame' | 'wide' | 'medium' | 'tight' | 'face';

export type FigureTreatment = {
  saturation?: number;     // 1.0 = neutral
  brightness?: number;     // 1.0 = neutral
  rim_light?: string | null;  // hex color or null
  glow?: string | null;       // hex color or null
};

export type FigureSpec = {
  role: FigureRole;
  crop: FigureCrop;
  position: { x_pct: number; y_pct: number };  // figure center, 0.0-1.0
  scale_pct: number;                             // figure height as fraction of canvas, 0.3-1.0
  mirrored?: boolean;
  treatment?: FigureTreatment;
  // Which source frame this figure uses (0/1/2). Defaults to 0 if omitted.
  // Used by the renderer to pull from the right bg-removed cutout AND, for crop:'frame'
  // or background-frame role, the right original frame.
  frame_index?: number;
};

export type BackgroundMode =
  | 'solid'
  | 'gradient'
  | 'monochrome-saturated'
  | 'frame-saturated'
  | 'algorithmic-spiral'
  | 'algorithmic-halo'
  | 'themed-image';

export type BackgroundSpec = {
  mode: BackgroundMode;
  colors?: string[];                    // for solid/gradient/monochrome-saturated
  gradient_angle_deg?: number;          // for gradient
  frame_shift?: { hue_deg: number; saturation: number };  // for frame-saturated
  algorithmic?: {
    color: string;
    opacity: number;       // HARD CAP at 0.4 (renderer will clamp)
    scale: number;
  };
  themed_prompt?: string;               // for themed-image (Flux prompt)
};

export type TextPlacementPct = {
  x_pct: number;
  y_pct: number;
  anchor: 'start' | 'middle' | 'end';
  max_width_pct: number;
};

export type CompositionSpec = {
  reasoning: string;
  figures: FigureSpec[];
  background: BackgroundSpec;
  lockup: LockupLineRender[];           // existing type, no changes
  text_placement: TextPlacementPct;
};

// Composition input for the renderer (vs the Composer's output spec).
// Adds the fields the renderer needs that aren't part of the spec itself.
export type CompositionRenderInput = {
  spec: CompositionSpec;
  // Original frames (one per figure that needs frame-source content, or one shared).
  // Used for: frame-saturated bg mode, figure crops with crop: 'frame'.
  source_frame_urls: string[];
  // Background-removed subject cutouts. Used for face/tight/medium/wide crops.
  subject_urls: string[];
  watermark_url?: string | null;
  watermark_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
};


// ---------------------------------------------------------------------------
// Register fonts globally with @napi-rs/canvas (once, on module load)
// Resvg-js does not properly render TTF font variations; canvas does.
// ---------------------------------------------------------------------------
let _fontsRegistered = false;
function ensureFontsRegistered(): void {
  if (_fontsRegistered) return;
  const fonts = loadAllFonts();
  for (const f of fonts) {
    // f.path is set by fonts.ts; if not, derive from spec
    const fontPath = (f as any).path;
    if (fontPath) {
      try {
        GlobalFonts.registerFromPath(fontPath, f.family);
      } catch (e) {
        console.warn(`[canvas] Failed to register font ${f.family} from ${fontPath}:`, e);
      }
    }
  }
  _fontsRegistered = true;
}


export const CANVAS_H = 720;

// ---------------------------------------------------------------------------
// Render input — what Claude provides per variant
// ---------------------------------------------------------------------------

export type TemplateRenderInput = {
  template_id: TemplateId;
  subject_urls: string[];
  lockup: LockupLineRender[];
  palette: string[];
  background_prompt?: string | null;  // Flux prompt; when present we AI-generate the bg, else algorithmic
  watermark_url?: string | null;
  watermark_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function pickColor(palette: string[], idx: number, fallback: string): string {
  return palette[idx] || palette[0] || fallback;
}

// ---------------------------------------------------------------------------
// Subject post-FX helpers (restored from pre-lockup commit)
// ---------------------------------------------------------------------------

async function subjectShadow(subject: Buffer, intensity: number = 0.5): Promise<Buffer> {
  const meta = await sharp(subject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const alpha = await sharp(subject).extractChannel('alpha').blur(20).linear(intensity, 0).toBuffer();
  const black = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
  return sharp(black).joinChannel(alpha).png().toBuffer();
}

async function subjectRimLight(subject: Buffer, colorHex: string, intensity: number = 0.35): Promise<Buffer> {
  const meta = await sharp(subject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const { r, g, b } = hexToRgb(colorHex);
  const alpha = await sharp(subject).extractChannel('alpha').toBuffer();
  const expanded = await sharp(alpha).blur(6).linear(1.2, 0).toBuffer();
  const edge = await sharp(expanded).composite([{ input: alpha, blend: 'dest-out' }]).linear(intensity, 0).toBuffer();
  const colored = await sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();
  return sharp(colored).joinChannel(edge).png().toBuffer();
}

async function prepSubject(raw: Buffer): Promise<Buffer> {
  const trimmed = await sharp(raw).trim({ threshold: 1 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  if (!meta.hasAlpha) return trimmed;
  const alpha = await sharp(trimmed).extractChannel('alpha').blur(2.2).toBuffer();
  const rgb = await sharp(trimmed).removeAlpha().toBuffer();
  return sharp(rgb).joinChannel(alpha).toBuffer();
}

async function generateBackgroundThematic(
  fluxPrompt: string,
  style: BackgroundStyle,
  palette: string[]
): Promise<Buffer> {
  // Try Flux first. On any error (NSFW, timeout, etc), fall back silently.
  try {
    const { generateBackground: fluxGenerate } = await import('@/lib/replicate');
    // Reinforce the content-safety guardrails in the prompt itself
    const safePrompt = `${fluxPrompt}. Photography, no people, no text, no watermarks. Cinematic lighting, atmospheric, high-end aesthetic.`;
    const fluxUrl = await fluxGenerate(safePrompt, '16:9');
    const res = await fetch(fluxUrl);
    if (!res.ok) throw new Error(`Flux result fetch failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // Resize to canvas dimensions in case Flux returned non-exact size
    return sharp(buf).resize(CANVAS_W, CANVAS_H, { fit: 'cover', position: 'center' }).png().toBuffer();
  } catch (err) {
    console.warn('[template-renderer] Flux background failed, falling back to algorithmic:', err instanceof Error ? err.message : err);
    return generateBackgroundAlgorithmic(style, palette);
  }
}

async function generateBackgroundAlgorithmic(style: BackgroundStyle, palette: string[]): Promise<Buffer> {
  // Palette convention from Claude: [text_fill, text_outline, bg_primary, bg_accent]
  // Backgrounds use indices 2 and 3.
  const c1 = pickColor(palette, 2, '#FF1493');
  const c2 = pickColor(palette, 3, '#9D4EDD');
  const c3 = pickColor(palette, 0, '#000000');  // fallback tertiary

  const W = CANVAS_W;
  const H = CANVAS_H;

  let svg = '';

  switch (style) {
    case 'flat-saturated':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${c1}"/></svg>`;
      break;

    case 'gradient':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
        </linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#g)"/>
      </svg>`;
      break;

    case 'dark-moody-bokeh': {
      // Dark background with soft colored circles (bokeh)
      const circles = [];
      for (let i = 0; i < 14; i++) {
        const cx = Math.random() * W;
        const cy = Math.random() * H;
        const r = 30 + Math.random() * 80;
        const color = Math.random() > 0.5 ? c1 : c2;
        const op = 0.15 + Math.random() * 0.25;
        circles.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${op}"/>`);
      }
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="bg" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="${c2}" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#0A0510"/>
        </radialGradient><filter id="blur"><feGaussianBlur stdDeviation="20"/></filter></defs>
        <rect width="${W}" height="${H}" fill="url(#bg)"/>
        <g filter="url(#blur)">${circles.join('')}</g>
      </svg>`;
      break;
    }

    case 'bright-abstract':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="ba" cx="50%" cy="50%" r="80%">
          <stop offset="0%" stop-color="${c3 || '#FFD700'}"/>
          <stop offset="50%" stop-color="${c1}"/>
          <stop offset="100%" stop-color="${c2}"/>
        </radialGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#ba)"/>
      </svg>`;
      break;

    case 'spiral-radial': {
      // Concentric circles creating spiral/hypno effect
      const rings = [];
      for (let i = 0; i < 12; i++) {
        const rad = (i + 1) * 80;
        const color = i % 2 === 0 ? c1 : (c3 || '#000000');
        const op = 0.7 - i * 0.04;
        rings.push(`<circle cx="${W/2}" cy="${H/2}" r="${rad}" fill="none" stroke="${color}" stroke-width="40" opacity="${op}"/>`);
      }
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${W}" height="${H}" fill="${c2}"/>
        ${rings.join('')}
      </svg>`;
      break;
    }

    case 'environmental-bokeh':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="eb" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#2D1B3D"/>
          <stop offset="60%" stop-color="${c1}" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="#1A0E25"/>
        </linearGradient><filter id="b"><feGaussianBlur stdDeviation="40"/></filter></defs>
        <rect width="${W}" height="${H}" fill="url(#eb)"/>
        <g filter="url(#b)" opacity="0.7">
          <circle cx="200" cy="180" r="120" fill="${c1}"/>
          <circle cx="1050" cy="500" r="160" fill="${c2}"/>
          <circle cx="640" cy="300" r="100" fill="${c3 || '#FFD700'}"/>
        </g>
      </svg>`;
      break;

    case 'dark-texture':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="dt" cx="50%" cy="50%" r="80%">
          <stop offset="0%" stop-color="${c1}" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="#050008"/>
        </radialGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#dt)"/>
      </svg>`;
      break;

    case 'pastel-bright':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="pb" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFE5F1"/>
          <stop offset="100%" stop-color="${c1}"/>
        </linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#pb)"/>
      </svg>`;
      break;

    case 'deep-neon': {
      const gridLines = [];
      for (let i = 0; i < 10; i++) {
        const y = H - i * 40 - 100;
        const op = 0.3 - i * 0.02;
        gridLines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c1}" stroke-width="1" opacity="${op}"/>`);
      }
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="dn" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#0A0012"/>
          <stop offset="70%" stop-color="${c2}" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="${c1}"/>
        </linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#dn)"/>
        ${gridLines.join('')}
      </svg>`;
      break;
    }

    default:
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${c1}"/></svg>`;
  }

  return await sharp(Buffer.from(svg)).png().toBuffer();
}


// ---------------------------------------------------------------------------
// SVG -> PNG using resvg (with bundled fonts)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Canvas-based text renderer (replaces Resvg for text — Resvg can't render
// non-Anton fonts correctly even with valid TTF buffers loaded)
// ---------------------------------------------------------------------------
// Lockup renderer — draws a stack of independently-styled lines.
// Each line picks its own font, size, fill, outline, italic, glow, rotation.
// Font is from the 20 registered FontKeys; canvas-based for reliable font matching.
// ---------------------------------------------------------------------------

export type LockupLineRender = {
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
};

function renderLockupWithCanvas(opts: {
  lockup: LockupLineRender[];
  placement: TextPlacement;
  canvasW: number;
  canvasH: number;
}): Buffer {
  ensureFontsRegistered();

  const { lockup, placement, canvasW, canvasH } = opts;
  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  ctx.textAlign = placement.anchor === 'start' ? 'left'
                : placement.anchor === 'end' ? 'right'
                : 'center';
  ctx.textBaseline = 'alphabetic';

  // Pre-measure each line at its requested size; clamp to placement.maxWidth
  type Sized = LockupLineRender & {
    fontSizePx: number;
    family: string;
    measuredWidth: number;
    actualHeight: number;
  };

  const sized: Sized[] = lockup.map((line) => {
    const family = getFontFamily(line.font);
    const italic = line.italic ? 'italic ' : '';
    let fontSizePx = Math.max(18, Math.round(canvasH * line.size_pct));

    // Shrink if the line overflows max width
    let measured: number;
    for (let attempt = 0; attempt < 30; attempt++) {
      ctx.font = `${italic}900 ${fontSizePx}px "${family}"`;
      measured = ctx.measureText(line.text).width;
      if (measured <= placement.maxWidth || fontSizePx <= 18) break;
      fontSizePx -= 2;
    }

    // Approximate visual height (caps height ~ 0.72 * fontSize for display fonts)
    const actualHeight = Math.round(fontSizePx * 0.78);
    return {
      ...line,
      fontSizePx,
      family,
      measuredWidth: measured!,
      actualHeight,
    };
  });

  // Compute total stack height with line gaps
  const GAP = Math.round(canvasH * 0.012);
  const totalHeight = sized.reduce((sum, s, i) => sum + s.actualHeight + (i > 0 ? GAP : 0), 0);

  // Position the stack relative to placement.y. placement.y is the baseline
  // anchor for single-line text; for the stack we adjust so the *visual block*
  // sits where placement asks.
  let topY: number;
  if (placement.verticalAlign === 'top') {
    topY = placement.y;
  } else if (placement.verticalAlign === 'center') {
    topY = placement.y - totalHeight / 2;
  } else {
    // 'bottom' — placement.y is the baseline of the bottom line; back up
    topY = placement.y - totalHeight;
  }

  // Render each line top-down
  let y = topY;
  for (const s of sized) {
    y += s.actualHeight; // baseline of this line

    ctx.save();

    // Rotate around the line's anchor x, current baseline y
    if (s.rotation_deg && s.rotation_deg !== 0) {
      ctx.translate(placement.x, y);
      ctx.rotate((s.rotation_deg * Math.PI) / 180);
      ctx.translate(-placement.x, -y);
    }

    const italic = s.italic ? 'italic ' : '';
    ctx.font = `${italic}900 ${s.fontSizePx}px "${s.family}"`;

    // Letter spacing (Skia/canvas does not natively support letter-spacing
    // CSS, so we render character-by-character if requested)
    const letterSpacingPx = s.letter_spacing_pct
      ? s.fontSizePx * s.letter_spacing_pct
      : 0;

    // Drop shadow (under everything)
    if (s.shadow !== false) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = Math.round(s.fontSizePx * 0.20);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.round(s.fontSizePx * 0.06);
      ctx.fillStyle = s.fill;
      drawTextWithSpacing(ctx, s.text, placement.x, y, letterSpacingPx, ctx.textAlign);
      ctx.restore();
    }

    // Outer glow (rendered as a wide stroke under the text)
    if (s.glow_color) {
      ctx.save();
      ctx.shadowColor = s.glow_color;
      ctx.shadowBlur = Math.round(s.fontSizePx * 0.45);
      ctx.lineWidth = Math.round(s.fontSizePx * 0.10);
      ctx.strokeStyle = s.glow_color;
      strokeTextWithSpacing(ctx, s.text, placement.x, y, letterSpacingPx, ctx.textAlign);
      ctx.restore();
    }

    // Outline stroke
    const outlinePct = s.outline_width_pct ?? 0.08;
    const strokeWidth = Math.max(3, Math.round(s.fontSizePx * outlinePct));
    ctx.strokeStyle = s.outline_color;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.miterLimit = 2;
    strokeTextWithSpacing(ctx, s.text, placement.x, y, letterSpacingPx, ctx.textAlign);

    // Fill on top
    ctx.fillStyle = s.fill;
    drawTextWithSpacing(ctx, s.text, placement.x, y, letterSpacingPx, ctx.textAlign);

    ctx.restore();

    y += GAP;
  }

  return canvas.toBuffer('image/png');
}

// Helper: draw text with manual letter-spacing (canvas has no letterSpacing API)
function drawTextWithSpacing(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: CanvasTextAlign,
) {
  if (!spacing) {
    ctx.fillText(text, x, y);
    return;
  }
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let cursor =
    align === 'left' ? x
    : align === 'right' ? x - total
    : x - total / 2;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], cursor, y);
    cursor += widths[i] + spacing;
  }
}

function strokeTextWithSpacing(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: CanvasTextAlign,
) {
  if (!spacing) {
    ctx.strokeText(text, x, y);
    return;
  }
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let cursor =
    align === 'left' ? x
    : align === 'right' ? x - total
    : x - total / 2;
  for (let i = 0; i < text.length; i++) {
    ctx.strokeText(text[i], cursor, y);
    cursor += widths[i] + spacing;
  }
}


// ---------------------------------------------------------------------------
// Subject placement per layout
// ---------------------------------------------------------------------------

type PositionedSubject = {
  buffer: Buffer;
  shadow: Buffer;
  rim: Buffer;
  left: number;
  top: number;
  bbox: { left: number; top: number; right: number; bottom: number };
};

async function positionedFrom(subject: Buffer, left: number, top: number, rimColor: string, shadowIntensity: number): Promise<PositionedSubject> {
  const meta = await sharp(subject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const shadow = await subjectShadow(subject, shadowIntensity);
  const rim = await subjectRimLight(subject, rimColor, 0.35);
  return {
    buffer: subject, shadow, rim, left, top,
    bbox: { left, top, right: left + w, bottom: top + h },
  };
}

async function layoutSingle(subject: Buffer, rimColor: string): Promise<PositionedSubject[]> {
  // Scale subject to ~92% canvas height but ALSO cap width at ~50% canvas width so the left half is free for text
  const scaled = await sharp(subject)
    .resize({
      height: Math.round(CANVAS_H * 0.92),
      width: Math.round(CANVAS_W * 0.52),
      fit: 'inside',
    })
    .toBuffer();
  const meta = await sharp(scaled).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  // Anchor subject to the right third — her left edge sits around 52% of canvas width
  const left = Math.round(CANVAS_W * 0.52);
  // Leave 6% headroom at top so head never clips, anchor bottom to canvas bottom
  const top = Math.max(Math.round(CANVAS_H * 0.06), CANVAS_H - h);
  return [await positionedFrom(scaled, left, top, rimColor, 0.55)];
}

async function layoutMirror(subject: Buffer, rimColor: string): Promise<PositionedSubject[]> {
  const target = await sharp(subject).resize({ height: Math.round(CANVAS_H * 0.85), fit: 'inside' }).toBuffer();
  const meta = await sharp(target).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const leftCopy = target;
  const rightCopy = await sharp(target).flop().toBuffer();
  const topY = CANVAS_H - h;
  // Spread figures wider to give the text candidate (mirror-center, maxWidth 0.38) clean room.
  // Previous 0.22 / 0.78 left only ~0.32 clear channel — text bled into figures.
  const leftX = Math.round(CANVAS_W * 0.18 - w / 2);
  const rightX = Math.round(CANVAS_W * 0.82 - w / 2);
  return [
    await positionedFrom(leftCopy, leftX, topY, rimColor, 0.5),
    await positionedFrom(rightCopy, rightX, topY, rimColor, 0.5),
  ];
}


async function layoutPairClose(subjects: Buffer[], rimColor: string): Promise<PositionedSubject[]> {
  // 2 different figures, both at ~85% canvas height, slightly overlapping at inner edges
  // Left figure positioned at left-center, right figure at right-center
  // Inner edges should overlap by ~5-8% to create "touching" feel
  if (subjects.length < 2) {
    // Fallback to single layout if only 1 subject available
    return layoutSingle(subjects[0], rimColor);
  }

  const positioned: PositionedSubject[] = [];

  for (let i = 0; i < 2; i++) {
    const scaled = await sharp(subjects[i])
      .resize({ height: Math.round(CANVAS_H * 0.92), fit: 'inside' })
      .toBuffer();
    const meta = await sharp(scaled).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;

    // Left figure: anchored so its right edge lands at ~52% of canvas
    // Right figure: anchored so its left edge lands at ~48% of canvas
    // This creates an 8% overlap at center
    let left: number;
    if (i === 0) {
      // Left figure — push right so right edge is at 52% W
      left = Math.round(CANVAS_W * 0.52) - w;
    } else {
      // Right figure — left edge at 48% W
      left = Math.round(CANVAS_W * 0.48);
    }

    // Clamp to canvas bounds
    left = Math.max(0, Math.min(left, CANVAS_W - w));

    // Top: leave 6% headroom, anchor bottom to canvas bottom
    const top = Math.max(Math.round(CANVAS_H * 0.06), CANVAS_H - h);

    positioned.push(await positionedFrom(scaled, left, top, rimColor, 0.55));
  }

  return positioned;
}

async function layoutTripleDiff(subjects: Buffer[], rimColor: string): Promise<PositionedSubject[]> {
  // Three DIFFERENT subjects: center biggest, sides smaller, with overlap
  const centerTarget = await sharp(subjects[0]).resize({ height: Math.round(CANVAS_H * 0.98), fit: 'inside' }).toBuffer();
  const leftSource = subjects[1] || subjects[0];
  const rightSource = subjects[2] || subjects[0];
  const leftTarget = await sharp(leftSource).resize({ height: Math.round(CANVAS_H * 0.75), fit: 'inside' }).toBuffer();
  const rightTarget = await sharp(rightSource).resize({ height: Math.round(CANVAS_H * 0.75), fit: 'inside' }).toBuffer();

  const cMeta = await sharp(centerTarget).metadata();
  const lMeta = await sharp(leftTarget).metadata();
  const rMeta = await sharp(rightTarget).metadata();
  const cw = cMeta.width || 0;
  const ch = cMeta.height || 0;
  const lw = lMeta.width || 0;
  const lh = lMeta.height || 0;
  const rw = rMeta.width || 0;
  const rh = rMeta.height || 0;

  const leftPos = { left: Math.round(CANVAS_W * 0.16 - lw / 2), top: CANVAS_H - lh };
  const rightPos = { left: Math.round(CANVAS_W * 0.84 - rw / 2), top: CANVAS_H - rh };
  const centerPos = { left: Math.round(CANVAS_W / 2 - cw / 2), top: CANVAS_H - ch };

  return [
    await positionedFrom(leftTarget, leftPos.left, leftPos.top, rimColor, 0.4),
    await positionedFrom(rightTarget, rightPos.left, rightPos.top, rimColor, 0.4),
    await positionedFrom(centerTarget, centerPos.left, centerPos.top, rimColor, 0.55),
  ];
}

async function layoutSplitDiff(subjects: Buffer[], rimColor: string): Promise<PositionedSubject[]> {
  // Two DIFFERENT subjects side by side, each filling their half
  const leftTarget = await sharp(subjects[0]).resize({ height: Math.round(CANVAS_H * 0.95), fit: 'inside' }).toBuffer();
  const rightTarget = await sharp(subjects[1] || subjects[0]).resize({ height: Math.round(CANVAS_H * 0.95), fit: 'inside' }).toBuffer();
  const lMeta = await sharp(leftTarget).metadata();
  const rMeta = await sharp(rightTarget).metadata();
  const lw = lMeta.width || 0;
  const lh = lMeta.height || 0;
  const rw = rMeta.width || 0;
  const rh = rMeta.height || 0;
  const leftPos = { left: Math.round(CANVAS_W * 0.25 - lw / 2), top: CANVAS_H - lh };
  const rightPos = { left: Math.round(CANVAS_W * 0.75 - rw / 2), top: CANVAS_H - rh };
  return [
    await positionedFrom(leftTarget, leftPos.left, leftPos.top, rimColor, 0.5),
    await positionedFrom(rightTarget, rightPos.left, rightPos.top, rimColor, 0.5),
  ];
}

// ---------------------------------------------------------------------------
// Text placement per template (which corner/zone)
// ---------------------------------------------------------------------------

/**
 * Per-layout exclusion configuration.
 * Controls how much of each subject's bounding box counts as "occupied" for
 * text-placement purposes, and whether overlapping the occupied zone is
 * acceptable when no clean candidate is available.
 *
 * Exported so background-generation passes (algorithmic backgrounds,
 * frame_saturated) can read the same exclusion data and avoid placing
 * decorative elements over subjects.
 */
export type ExclusionConfig = {
  /** Fraction of bbox height (from top) treated as occupied. 0.0-1.0. */
  bodyRatio: number;
  /** If true, overlapping the occupied zone is acceptable as the design intent. */
  allowOverlap: boolean;
};

const EXCLUSION_BY_LAYOUT: Record<string, ExclusionConfig> = {
  // One tall figure - text should be well clear of head AND torso.
  single:        { bodyRatio: 0.85, allowOverlap: false },
  // Two flanking figures - center channel is the target, torsos are off-limits.
  mirror:        { bodyRatio: 0.65, allowOverlap: false },
  // Three figures fill the bottom - top band is the only safe zone.
  'triple-diff': { bodyRatio: 0.95, allowOverlap: false },
  // Split layout - center channel + bottom band, most of frame is occupied.
  'split-diff':  { bodyRatio: 0.70, allowOverlap: false },
  // Princess Mindfuck-style - text deliberately overlaps inner bodies.
  'pair-close':  { bodyRatio: 0.40, allowOverlap: true  },
};

const DEFAULT_EXCLUSION: ExclusionConfig = { bodyRatio: 0.85, allowOverlap: false };

export function getExclusionConfig(layout: string): ExclusionConfig {
  return EXCLUSION_BY_LAYOUT[layout] ?? DEFAULT_EXCLUSION;
}

function pickTextPlacement(template: TemplateSpec, subjectBoxes: { left: number; top: number; right: number; bottom: number }[]): TextPlacement {
  const pad = Math.round(CANVAS_H * 0.06);
  const exclusion = getExclusionConfig(template.layout);

  // Find a SAFE text zone by checking candidate bands in order of preference
  const textHeight = Math.round(CANVAS_H * 0.28); // estimated text height (matches 28% size)

  // Candidate zones per layout, in priority order
  type Candidate = { x: number; y: number; anchor: 'start' | 'middle' | 'end'; maxWidth: number; label: string };
  let candidates: Candidate[] = [];

  switch (template.layout) {
    case 'single':
      candidates = [
        // Left half, vertically centered — subject is on right
        { x: Math.round(CANVAS_W * 0.04), y: Math.round(CANVAS_H * 0.52), anchor: 'start', maxWidth: Math.round(CANVAS_W * 0.48), label: 'left-center' },
        { x: Math.round(CANVAS_W * 0.04), y: Math.round(CANVAS_H * 0.38), anchor: 'start', maxWidth: Math.round(CANVAS_W * 0.48), label: 'left-upper' },
        { x: Math.round(CANVAS_W * 0.04), y: Math.round(CANVAS_H * 0.75), anchor: 'start', maxWidth: Math.round(CANVAS_W * 0.48), label: 'left-lower' },
      ];
      break;

    case 'mirror':
      candidates = [
        // Top band — above both subjects' heads.
        // We deliberately omit a center-channel candidate: Claude's size_pct doesn't know the
        // figures' rendered widths, so text-between-figures consistently overflows into the
        // figures. If text-between-figures returns, it should be a new layout (e.g. 'mirror-wide')
        // with figures at 0.12/0.88 and a wide-enough gap that overflow is structurally impossible.
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.14), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.88), label: 'mirror-top' },
        // Bottom band — below the subjects (if they don't fill full height).
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.92), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.88), label: 'mirror-bottom' },
      ];
      break;

    case 'triple-diff':
      candidates = [
        // Top band is safest when 3 figures fill bottom
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.14), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.88), label: 'triple-top' },
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.92), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.82), label: 'triple-bottom' },
      ];
      break;

    case 'split-diff':
      candidates = [
        // Center channel if there's a gap between the two split subjects
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.5), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.35), label: 'split-center' },
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.92), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.75), label: 'split-bottom' },
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.14), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.75), label: 'split-top' },
      ];
      break;

    case 'pair-close':
      candidates = [
        // Center between/over the two figures — text overlaps the inner bodies
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.55), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.55), label: 'pair-center' },
        // Fallback: top band above both heads
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.14), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.85), label: 'pair-top' },
      ];
      break;

    default:
      candidates = [
        { x: CANVAS_W / 2, y: CANVAS_H - pad, anchor: 'middle', maxWidth: CANVAS_W - pad * 2, label: 'default-bottom' },
      ];
  }

  // Build per-layout exclusion zones from each subject's bbox.
  // bodyRatio determines how far down from the top of the bbox is "off limits".
  const exclusionZones = subjectBoxes.map((b) => ({
    top: b.top,
    bottom: b.top + (b.bottom - b.top) * exclusion.bodyRatio,
    left: b.left,
    right: b.right,
  }));

  const overlapsExclusion = (yTop: number, yBottom: number, xLeft: number, xRight: number) => {
    return exclusionZones.some((hz) =>
      hz.top < yBottom && hz.bottom > yTop && hz.left < xRight && hz.right > xLeft
    );
  };

  for (const c of candidates) {
    // Estimate the bounding box of the text at this candidate position
    const yTop = c.y - textHeight * 0.8;
    const yBottom = c.y + textHeight * 0.2;
    const xLeft = c.anchor === 'start' ? c.x : c.anchor === 'end' ? c.x - c.maxWidth : c.x - c.maxWidth / 2;
    const xRight = xLeft + c.maxWidth;

    if (!overlapsExclusion(yTop, yBottom, xLeft, xRight)) {
      return { x: c.x, y: c.y, anchor: c.anchor, maxWidth: c.maxWidth, verticalAlign: 'bottom' };
    }
  }

  // No clean candidate found.
  // For layouts where overlap IS the intended design (e.g. pair-close), this is the happy path.
  // For others, this is a fallback - the renderer never crashes, but the result may crowd the subject.
  const fb = candidates[0];
  return { x: fb.x, y: fb.y, anchor: fb.anchor, maxWidth: fb.maxWidth, verticalAlign: 'bottom' };
}

// ---------------------------------------------------------------------------
// Final polish pass
// ---------------------------------------------------------------------------

async function polishPass(img: Buffer): Promise<Buffer> {
  const vignette = Buffer.from(
    `<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="vg" cx="50%" cy="50%" r="75%">
        <stop offset="60%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.32"/>
      </radialGradient></defs>
      <rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#vg)"/>
    </svg>`
  );
  return sharp(img)
    .modulate({ saturation: 1.10, brightness: 1.02 })
    .composite([{ input: vignette, blend: 'over' }])
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Watermark positioning
// ---------------------------------------------------------------------------

function wmOffset(pos: string | undefined, wmW: number, wmH: number) {
  const pad = 24;
  switch (pos) {
    case 'top-left': return { left: pad, top: pad };
    case 'top-right': return { left: CANVAS_W - wmW - pad, top: pad };
    case 'bottom-left': return { left: pad, top: CANVAS_H - wmH - pad };
    case 'center': return { left: Math.round((CANVAS_W - wmW) / 2), top: Math.round((CANVAS_H - wmH) / 2) };
    case 'bottom-right':
    default: return { left: CANVAS_W - wmW - pad, top: CANVAS_H - wmH - pad };
  }
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Composer helpers — used by renderComposition (the new AI-driven pipeline)
// ---------------------------------------------------------------------------

/**
 * Convert pct-based text placement (Composer output) to px-based TextPlacement
 * (existing renderLockupWithCanvas input).
 */
function textPlacementFromPct(p: TextPlacementPct): TextPlacement {
  // Clamp y to keep lockup on canvas vertically.
  const safeY = Math.max(0.18, Math.min(0.82, p.y_pct));

  // Clamp x based on anchor + max_width so the lockup never extends off canvas.
  // - 'middle' anchor needs x at least max_width/2 from each edge
  // - 'start' anchor needs x at most (1 - max_width) from the left
  // - 'end' anchor needs x at least max_width from the left
  const halfW = p.max_width_pct / 2;
  let safeX: number;
  if (p.anchor === 'middle') {
    safeX = Math.max(halfW, Math.min(1 - halfW, p.x_pct));
  } else if (p.anchor === 'start') {
    safeX = Math.max(0.04, Math.min(1 - p.max_width_pct - 0.04, p.x_pct));
  } else { // 'end'
    safeX = Math.max(p.max_width_pct + 0.04, Math.min(0.96, p.x_pct));
  }

  return {
    x: Math.round(safeX * CANVAS_W),
    y: Math.round(safeY * CANVAS_H),
    maxWidth: Math.round(p.max_width_pct * CANVAS_W),
    anchor: p.anchor,
    verticalAlign: 'center',
  };
}

/**
 * Crop a figure asset per the Composer's crop level.
 * - 'frame' uses the original frame (no bg removal)
 * - 'wide' uses the bg-removed subject as-is
 * - 'medium' / 'tight' / 'face' progressively crop tighter from the top of the bg-removed subject
 */
async function cropFigure(
  bgRemovedSubject: Buffer,
  sourceFrame: Buffer,
  crop: FigureCrop
): Promise<Buffer> {
  // Source frames are JPEGs (no alpha channel); ensure RGBA before downstream
  // operations like subjectShadow that call extractChannel('alpha').
  if (crop === 'frame') {
    return sharp(sourceFrame).ensureAlpha().png().toBuffer();
  }
  if (crop === 'wide') return bgRemovedSubject;

  // For tighter crops, crop the bg-removed subject from the top.
  // medium = top 75% (waist-up), tight = top 45% (head+shoulders), face = top 28% (face only)
  const meta = await sharp(bgRemovedSubject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w === 0 || h === 0) return bgRemovedSubject;

  const cropPct = crop === 'medium' ? 0.75 : crop === 'tight' ? 0.45 : 0.28;
  const cropH = Math.max(1, Math.round(h * cropPct));
  return sharp(bgRemovedSubject).extract({ left: 0, top: 0, width: w, height: cropH }).toBuffer();
}

/**
 * Render a background per the Composer's BackgroundSpec.mode.
 * Falls back to monochrome-saturated for unimplemented modes (algorithmic-spiral, algorithmic-halo).
 */
async function renderComposerBackground(
  bg: BackgroundSpec,
  sourceFrame: Buffer,
  brandColors: { primary: string; accent: string }
): Promise<Buffer> {
  const W = CANVAS_W;
  const H = CANVAS_H;

  switch (bg.mode) {
    case 'solid': {
      const color = bg.colors?.[0] || brandColors.primary;
      const { r, g, b } = hexToRgb(color);
      return sharp({ create: { width: W, height: H, channels: 3, background: { r, g, b } } }).png().toBuffer();
    }

    case 'gradient': {
      const c1 = bg.colors?.[0] || brandColors.primary;
      const c2 = bg.colors?.[1] || brandColors.accent;
      const angle = bg.gradient_angle_deg ?? 135;
      // Convert angle to SVG linear gradient endpoints
      const rad = (angle * Math.PI) / 180;
      const x1 = 50 - Math.cos(rad) * 50;
      const y1 = 50 - Math.sin(rad) * 50;
      const x2 = 50 + Math.cos(rad) * 50;
      const y2 = 50 + Math.sin(rad) * 50;
      const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
            <stop offset="0%" stop-color="${c1}"/>
            <stop offset="100%" stop-color="${c2}"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>`;
      return sharp(Buffer.from(svg)).png().toBuffer();
    }

    case 'monochrome-saturated': {
      // Single dominant color + radial light center + subtle bokeh circles + edge vignette.
      // Looks like the aspirational set's soft purple/pink backgrounds with depth and atmosphere.
      const color = bg.colors?.[0] || brandColors.primary;
      const accent = bg.colors?.[1] || brandColors.accent;
      // Pseudo-random bokeh placement based on color hash for stability across renders
      const seed = (color.charCodeAt(1) + color.charCodeAt(2)) % 7;
      const bokehCircles = [
        { cx: 15 + seed * 2, cy: 80, r: 8 },
        { cx: 88, cy: 25 + seed, r: 6 },
        { cx: 75, cy: 70, r: 10 },
        { cx: 25, cy: 30, r: 5 },
        { cx: 60, cy: 90, r: 7 },
      ].map((c) => `<circle cx="${c.cx}%" cy="${c.cy}%" r="${c.r}%" fill="${accent}" opacity="0.18"/>`).join('');
      const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="lite" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stop-color="${color}" stop-opacity="1.0"/>
            <stop offset="70%" stop-color="${color}" stop-opacity="0.85"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0.55"/>
          </radialGradient>
          <radialGradient id="vig" cx="50%" cy="50%" r="75%">
            <stop offset="60%" stop-color="#000" stop-opacity="0"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0.25"/>
          </radialGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="40"/></filter>
        </defs>
        <rect width="100%" height="100%" fill="${color}"/>
        <rect width="100%" height="100%" fill="url(#lite)"/>
        <g filter="url(#blur)">${bokehCircles}</g>
        <rect width="100%" height="100%" fill="url(#vig)"/>
      </svg>`;
      return sharp(Buffer.from(svg)).png().toBuffer();
    }

    case 'frame-saturated': {
      // Take the source frame, color-shift, blur slightly so the subject overlaid on top pops.
      // This is the *Too Pathetic to Perform* style.
      const shift = bg.frame_shift || { hue_deg: 0, saturation: 1.4 };
      return sharp(sourceFrame)
        .resize(W, H, { fit: 'cover' })
        .modulate({ saturation: shift.saturation, hue: shift.hue_deg })
        .blur(8)
        .toBuffer();
    }

    case 'themed-image': {
      // Reuse existing Flux pipeline. style/palette args satisfy the function signature.
      const prompt = bg.themed_prompt || 'soft pink and purple atmospheric';
      const palette = [bg.colors?.[0] || brandColors.primary, bg.colors?.[1] || brandColors.accent, brandColors.primary, brandColors.accent];
      return generateBackgroundThematic(prompt, 'gradient', palette);
    }

    case 'algorithmic-spiral':
    case 'algorithmic-halo': {
      // Not yet implemented — fall back to monochrome-saturated using the algorithmic.color hint if present.
      console.warn(`[renderComposerBackground] mode '${bg.mode}' not yet implemented, falling back to monochrome-saturated`);
      const fallbackColor = bg.algorithmic?.color || bg.colors?.[0] || brandColors.primary;
      return renderComposerBackground(
        { mode: 'monochrome-saturated', colors: [fallbackColor] },
        sourceFrame,
        brandColors
      );
    }

    default: {
      console.warn(`[renderComposerBackground] unknown mode, falling back to monochrome-saturated`);
      return renderComposerBackground(
        { mode: 'monochrome-saturated', colors: [brandColors.primary] },
        sourceFrame,
        brandColors
      );
    }
  }
}

/**
 * Place a figure on canvas per its FigureSpec.
 * Returns the buffer, position (left/top), and bounding box for downstream layering.
 */
async function placeComposerFigure(
  figureBuf: Buffer,
  spec: FigureSpec
): Promise<{ buffer: Buffer; left: number; top: number; w: number; h: number }> {
  // Apply mirroring first (cheap)
  let working = spec.mirrored ? await sharp(figureBuf).flop().toBuffer() : figureBuf;

  // Resize to scale_pct of canvas height
  const targetH = Math.round(CANVAS_H * Math.max(0.1, Math.min(1.0, spec.scale_pct)));
  working = await sharp(working).resize({ height: targetH, fit: 'inside' }).toBuffer();

  const meta = await sharp(working).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;

  // position is figure CENTER, in canvas pct
  const centerX = Math.round(spec.position.x_pct * CANVAS_W);
  const centerY = Math.round(spec.position.y_pct * CANVAS_H);
  const naiveLeft = centerX - Math.round(w / 2);
  const naiveTop = centerY - Math.round(h / 2);

  // Figure-bottom clamp: if the figure would extend below canvas, anchor its
  // BOTTOM to canvas bottom instead of trying to honor the center exactly.
  // This is what the user means by "show the full model or cut off at the
  // thumbnail bottom" — never have a flat horizontal line through the torso.
  const naiveBottom = naiveTop + h;
  let top: number;
  if (naiveBottom > CANVAS_H) {
    // Anchor figure bottom to canvas bottom
    top = CANVAS_H - h;
  } else {
    // Normal center-based positioning, clamped to canvas
    top = Math.max(0, Math.min(naiveTop, CANVAS_H - h));
  }
  const left = Math.max(0, Math.min(naiveLeft, CANVAS_W - w));

  // Apply treatment (saturation/brightness) if present
  if (spec.treatment?.saturation || spec.treatment?.brightness) {
    working = await sharp(working).modulate({
      saturation: spec.treatment.saturation ?? 1.0,
      brightness: spec.treatment.brightness ?? 1.0,
    }).toBuffer();
  }

  return { buffer: working, left, top, w, h };
}

// ---------------------------------------------------------------------------
// renderComposition — the new AI-driven render path.
// Consumes a CompositionSpec from the Composer, executes it deterministically.
// Old renderTemplate is kept alive below until cutover is complete.
// ---------------------------------------------------------------------------

export async function renderComposition(input: CompositionRenderInput): Promise<Buffer> {
  ensureFontsRegistered();

  const { spec, source_frame_urls, subject_urls, watermark_url, watermark_position } = input;

  // ---- 0. Defensive guards on the spec ----
  if (!spec) throw new Error('renderComposition: spec is null/undefined');
  if (!spec.figures || spec.figures.length === 0) {
    throw new Error('renderComposition: spec has no figures (Composer produced an empty composition)');
  }
  if (!spec.lockup || spec.lockup.length === 0) {
    throw new Error('renderComposition: spec has no lockup lines');
  }
  if (!spec.background?.mode) {
    throw new Error('renderComposition: spec has no background mode');
  }
  if (!spec.text_placement) {
    throw new Error('renderComposition: spec has no text_placement');
  }

  // ---- 1. Fetch all source assets ----
  if (source_frame_urls.length === 0) throw new Error('renderComposition: no source_frame_urls provided');
  if (subject_urls.length === 0) throw new Error('renderComposition: no subject_urls provided');

  const [sourceFrames, subjects] = await Promise.all([
    Promise.all(source_frame_urls.map(fetchBuffer)),
    Promise.all(subject_urls.map(fetchBuffer)),
  ]);

  // Prep subjects (existing helper does saturation/contrast/edge cleanup)
  const preppedSubjects = await Promise.all(subjects.map(prepSubject));

  // ---- 2. Brand color fallback ----
  // The Composer should output palette colors directly, but if a bg spec leaves colors empty,
  // fall back to the brand pink/purple. The renderer doesn't know the model's brand colors
  // directly — they need to be threaded through. For now, use sensible defaults; the Inngest
  // function passes them via the spec's bg.colors when calling.
  const brandColors = {
    primary: spec.background.colors?.[0] || '#FF1493',
    accent: spec.background.colors?.[1] || '#9D4EDD',
  };

  // ---- 3. Render background ----
  // For frame-saturated mode, the bg uses the source frame. Prefer the frame_index
  // of any background-frame figure if one exists (those compositions explicitly tie
  // bg and overlay to specific frames). Otherwise default to frame 0.
  const bgFrameFigure = spec.figures.find((f) => f.role === 'background-frame');
  const bgFrameIdx = bgFrameFigure?.frame_index ?? 0;
  const bgSourceFrame = sourceFrames[bgFrameIdx] || sourceFrames[0];

  let backgroundBuf = await renderComposerBackground(spec.background, bgSourceFrame, brandColors);
  // Slight darken — same polish step renderTemplate does, keeps tones richer.
  backgroundBuf = await sharp(backgroundBuf).modulate({ brightness: 0.92 }).toBuffer();

  // ---- 4. Process figures in z-order ----
  // Z-order: background-frame -> flank/hero -> overlay -> (lockup, watermark added later)
  const zOrder: Record<FigureRole, number> = {
    'background-frame': 0,
    'flank-left': 1,
    'flank-right': 1,
    'hero': 2,
    'overlay': 3,
  };

  const sortedFigures = [...spec.figures].sort((a, b) => zOrder[a.role] - zOrder[b.role]);

  // Resolve each figure's source asset based on its crop level.
  // 'frame' uses the source frame; everything else uses the bg-removed subject.
  // For multi-figure specs, we round-robin through subjects/frames so each figure can
  // come from a different source if the Composer specified that intent.
  const placedFigures: Array<{
    spec: FigureSpec;
    placement: { buffer: Buffer; left: number; top: number; w: number; h: number };
  }> = [];

  for (let i = 0; i < sortedFigures.length; i++) {
    const figSpec = sortedFigures[i];
    // Use the figure's specified frame_index (defaults to 0). Clamp to available range.
    const frameIdx = Math.min(
      Math.max(0, figSpec.frame_index ?? 0),
      Math.max(preppedSubjects.length, sourceFrames.length) - 1
    );
    const subjectBuf = preppedSubjects[frameIdx % preppedSubjects.length];
    const frameBuf = sourceFrames[frameIdx % sourceFrames.length];

    const cropped = await cropFigure(subjectBuf, frameBuf, figSpec.crop);
    const placed = await placeComposerFigure(cropped, figSpec);
    placedFigures.push({ spec: figSpec, placement: placed });
  }

  // ---- 5. Composite layers ----
  const overlays: sharp.OverlayOptions[] = [];

  // For each figure (in z-order), add: shadow, then figure, then rim light if specified
  for (const { spec: figSpec, placement } of placedFigures) {
    // Shadow goes behind everything in this figure's stack
    const shadowBuf = await subjectShadow(placement.buffer, 0.5);
    overlays.push({ input: shadowBuf, left: placement.left + 12, top: placement.top + 18 });

    // The figure itself
    overlays.push({ input: placement.buffer, left: placement.left, top: placement.top });

    // Rim light if treatment specified
    if (figSpec.treatment?.rim_light) {
      const rim = await subjectRimLight(placement.buffer, figSpec.treatment.rim_light, 0.4);
      overlays.push({ input: rim, left: placement.left, top: placement.top, blend: 'screen' });
    }
  }

  // ---- 6. Lockup ----
  const placement = textPlacementFromPct(spec.text_placement);
  const lockupBuf = renderLockupWithCanvas({
    lockup: spec.lockup,
    placement,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
  });
  overlays.push({ input: lockupBuf, left: 0, top: 0 });

  // ---- 7. Watermark ----
  if (watermark_url) {
    const wmRaw = await fetchBuffer(watermark_url);
    const wmSized = await sharp(wmRaw)
      .resize({ width: Math.round(CANVAS_W * 0.12), withoutEnlargement: true })
      .toBuffer();
    const wmMeta = await sharp(wmSized).metadata();
    const offset = wmOffset(watermark_position, wmMeta.width || 0, wmMeta.height || 0);
    overlays.push({ input: wmSized, left: offset.left, top: offset.top });
  }

  // ---- 8. Composite all layers and apply polish ----
  const composite = await sharp(backgroundBuf).composite(overlays).png().toBuffer();
  return polishPass(composite);
}

export async function renderTemplate(input: TemplateRenderInput): Promise<Buffer> {
  const template = TEMPLATES[input.template_id];
  if (!template) throw new Error(`Unknown template: ${input.template_id}`);

  const palette = input.palette.length > 0 ? input.palette : template.default_palette;

  // Fetch subject cutouts
  const subjectBuffers = await Promise.all(input.subject_urls.map(fetchBuffer));
  const preppedSubjects = await Promise.all(subjectBuffers.map(prepSubject));

  // Generate background — try Flux if we have a prompt, fall back to algorithmic
  const backgroundBuf = input.background_prompt
    ? await generateBackgroundThematic(input.background_prompt, template.background, palette)
    : await generateBackgroundAlgorithmic(template.background, palette);
  const background = await sharp(backgroundBuf).modulate({ brightness: 0.92 }).toBuffer();

  // Layout subjects
  const rimColor = pickColor(palette, 3, '#FF1493');  // rim = bg_accent for cohesion
  let positioned: PositionedSubject[];
  switch (template.layout) {
    case 'single': positioned = await layoutSingle(preppedSubjects[0], rimColor); break;
    case 'mirror': positioned = await layoutMirror(preppedSubjects[0], rimColor); break;
    case 'triple-diff': positioned = await layoutTripleDiff(preppedSubjects, rimColor); break;
    case 'split-diff': positioned = await layoutSplitDiff(preppedSubjects, rimColor); break;
    case 'pair-close': positioned = await layoutPairClose(preppedSubjects, rimColor); break;
    default: positioned = await layoutSingle(preppedSubjects[0], rimColor);
  }

  // Palette order (from Claude): [text_fill, text_outline, bg_primary, bg_accent]
  const textFill = pickColor(palette, 0, '#FFFFFF');
  const textOutline = pickColor(palette, 1, '#000000');

  // Build text — lockup renderer draws each styled line independently
  const textPlacement = pickTextPlacement(template, positioned.map(p => p.bbox));
  const textPng = renderLockupWithCanvas({
    lockup: input.lockup,
    placement: textPlacement,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
  });

  // Compose
  const layers: sharp.OverlayOptions[] = [];
  for (const p of positioned) layers.push({ input: p.shadow, left: p.left + 12, top: p.top + 18 });
  for (const p of positioned) layers.push({ input: p.buffer, left: p.left, top: p.top });
  for (const p of positioned) layers.push({ input: p.rim, left: p.left, top: p.top, blend: 'screen' });
  layers.push({ input: textPng, left: 0, top: 0 });

  if (input.watermark_url) {
    const wmRaw = await fetchBuffer(input.watermark_url);
    const wmSized = await sharp(wmRaw).resize({ width: Math.round(CANVAS_W * 0.12), withoutEnlargement: true }).toBuffer();
    const wmMeta = await sharp(wmSized).metadata();
    const offset = wmOffset(input.watermark_position, wmMeta.width || 0, wmMeta.height || 0);
    layers.push({ input: wmSized, left: offset.left, top: offset.top });
  }

  const raw = await sharp(background).composite(layers).png().toBuffer();
  return polishPass(raw);
}
