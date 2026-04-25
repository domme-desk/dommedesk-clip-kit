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
  const leftX = Math.round(CANVAS_W * 0.22 - w / 2);
  const rightX = Math.round(CANVAS_W * 0.78 - w / 2);
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

function pickTextPlacement(template: TemplateSpec, subjectBoxes: { left: number; top: number; right: number; bottom: number }[]): TextPlacement {
  const pad = Math.round(CANVAS_H * 0.06);

  // A subject "occupies" roughly the top 75% of its bounding box (head + torso).
  // Only the very top (head) is most important to avoid, but to be safe we treat the whole bbox as occupied.
  const occupiedBands = subjectBoxes.map((b) => ({
    top: b.top,
    bottom: b.bottom,
    left: b.left,
    right: b.right,
  }));

  // Horizontal band conflict check: does any subject bbox occupy the vertical range [yTop, yBottom]
  // AND overlap with the horizontal range [xLeft, xRight]?
  const overlapsSubject = (yTop: number, yBottom: number, xLeft: number, xRight: number) => {
    return occupiedBands.some((b) =>
      b.top < yBottom && b.bottom > yTop && b.left < xRight && b.right > xLeft
    );
  };

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
        // Between the two subjects — check center channel is clear
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.5), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.38), label: 'mirror-center' },
        // Top band — above both subjects' heads
        { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.14), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.88), label: 'mirror-top' },
        // Bottom band — below the subjects (if they don't fill full height)
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

  // Pick the first candidate whose text box doesn't overlap subjects' heads specifically.
  // Head = top 45% of bbox. We only want to avoid OVERLAP WITH HEADS, not entire body,
  // because mild body overlap can be OK in some layouts.
  const headZones = subjectBoxes.map((b) => ({
    top: b.top,
    bottom: b.top + (b.bottom - b.top) * 0.45,
    left: b.left,
    right: b.right,
  }));

  const overlapsHead = (yTop: number, yBottom: number, xLeft: number, xRight: number) => {
    return headZones.some((hz) =>
      hz.top < yBottom && hz.bottom > yTop && hz.left < xRight && hz.right > xLeft
    );
  };

  for (const c of candidates) {
    // Estimate the bounding box of the text at this candidate position
    const yTop = c.y - textHeight * 0.8;
    const yBottom = c.y + textHeight * 0.2;
    const xLeft = c.anchor === 'start' ? c.x : c.anchor === 'end' ? c.x - c.maxWidth : c.x - c.maxWidth / 2;
    const xRight = xLeft + c.maxWidth;

    if (!overlapsHead(yTop, yBottom, xLeft, xRight)) {
      return { x: c.x, y: c.y, anchor: c.anchor, maxWidth: c.maxWidth, verticalAlign: 'bottom' };
    }
  }

  // Fallback: use first candidate even if it overlaps
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
