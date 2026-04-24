import sharp from 'sharp';
import type { CompositionBrief } from './prompts';

export type CompositeInput = {
  backgroundUrl: string;
  subjectMaskUrl: string;
  brief: CompositionBrief;
  watermarkUrl?: string | null;
  watermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
};

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;

// --------------------------------------------------------------------------- //
// Utilities                                                                    //
// --------------------------------------------------------------------------- //

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

// --------------------------------------------------------------------------- //
// Part B.1 — Soft edge feather on subject mask                                //
// --------------------------------------------------------------------------- //

async function tightCropAndFeather(raw: Buffer): Promise<Buffer> {
  // First tight-crop
  const trimmed = await sharp(raw).trim({ threshold: 1 }).toBuffer();
  // Extract alpha, blur it slightly, then recomposite
  const meta = await sharp(trimmed).metadata();
  if (!meta.hasAlpha) return trimmed;

  // Feather the edge by blurring alpha channel by ~2.5px
  const alpha = await sharp(trimmed).extractChannel('alpha').blur(2.5).toBuffer();
  const rgb = await sharp(trimmed).removeAlpha().toBuffer();
  return sharp(rgb)
    .joinChannel(alpha)
    .toBuffer();
}

// --------------------------------------------------------------------------- //
// Part B.2 — Subject drop shadow                                              //
// --------------------------------------------------------------------------- //

async function buildSubjectShadow(subject: Buffer, intensity: number = 0.5): Promise<Buffer> {
  // Take alpha channel, blur heavily, tint black, use as shadow layer
  const meta = await sharp(subject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;

  const alpha = await sharp(subject).extractChannel('alpha').toBuffer();
  // Create a black RGB the same size as subject, use blurred alpha as its own alpha
  const blurredAlpha = await sharp(alpha).blur(20).linear(intensity, 0).toBuffer();
  const blackRgb = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();

  return sharp(blackRgb).joinChannel(blurredAlpha).png().toBuffer();
}

// --------------------------------------------------------------------------- //
// Part B.3 — Rim light (colored edge glow)                                    //
// --------------------------------------------------------------------------- //

async function buildRimLight(subject: Buffer, colorHex: string, intensity: number = 0.35): Promise<Buffer> {
  const meta = await sharp(subject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;

  const { r, g, b } = hexToRgb(colorHex);
  const alpha = await sharp(subject).extractChannel('alpha').toBuffer();
  // Expand alpha slightly (dilate-ish by blurring and strengthening), then subtract original to get edge
  const expanded = await sharp(alpha).blur(6).linear(1.2, 0).toBuffer();
  const edgeAlpha = await sharp(expanded).composite([{ input: alpha, blend: 'dest-out' }]).linear(intensity, 0).toBuffer();

  const colored = await sharp({
    create: { width: w, height: h, channels: 3, background: { r, g, b } },
  }).png().toBuffer();

  return sharp(colored).joinChannel(edgeAlpha).png().toBuffer();
}

// --------------------------------------------------------------------------- //
// Part B.6 — Subject color temperature match                                   //
// --------------------------------------------------------------------------- //

async function warmTintSubject(subject: Buffer, tintHex: string, opacity: number = 0.08): Promise<Buffer> {
  // Subtle warmth tint without destroying the subject's own pixels.
  // Use modulate for a gentle hue shift toward warm tones rather than overlaying solid color.
  // opacity parameter ignored for safety — we do a fixed gentle modulation.
  return sharp(subject)
    .modulate({ saturation: 1.05, brightness: 1.02 })
    .toBuffer();
}

// --------------------------------------------------------------------------- //
// Part A — Subject-aware text placement                                       //
// --------------------------------------------------------------------------- //

type BoundingBox = { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number };

async function getSubjectBoundingBox(subject: Buffer, canvasW: number, canvasH: number, left: number, top: number): Promise<BoundingBox> {
  const meta = await sharp(subject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  return {
    left, top,
    right: left + w,
    bottom: top + h,
    centerX: left + w / 2,
    centerY: top + h / 2,
  };
}

/**
 * Given subject bounding boxes on canvas, pick the best text position that doesn't overlap subject heads.
 * Head is the top ~35% of the bounding box.
 */
function pickSafeTextPosition(
  subjectBoxes: BoundingBox[],
  requestedPosition: string,
  canvasW: number,
  canvasH: number
): string {
  // Head zones = top ~35% of each subject box
  const headZones = subjectBoxes.map((b) => ({
    left: b.left,
    top: b.top,
    right: b.right,
    bottom: b.top + (b.bottom - b.top) * 0.4,
  }));

  // Define candidate text bands (top third, middle band, bottom third)
  const bands = {
    top: { top: 0, bottom: canvasH * 0.32 },
    center: { top: canvasH * 0.4, bottom: canvasH * 0.6 },
    bottom: { top: canvasH * 0.68, bottom: canvasH },
  };

  function bandOverlapsHeads(band: { top: number; bottom: number }): boolean {
    return headZones.some((hz) => hz.top < band.bottom && hz.bottom > band.top);
  }

  // If requested position's band is clear, use it
  const requested = requestedPosition.startsWith('top') ? 'top'
    : requestedPosition.startsWith('bottom') ? 'bottom'
    : 'center';

  const bandCheck: Record<string, { top: number; bottom: number }> = bands;
  if (!bandOverlapsHeads(bandCheck[requested])) return requestedPosition;

  // Otherwise pick the first safe band in order: bottom > top > center
  const preference: ('bottom' | 'top' | 'center')[] = ['bottom', 'top', 'center'];
  for (const p of preference) {
    if (!bandOverlapsHeads(bands[p])) return p;
  }
  // Fallback: use bottom anyway
  return 'bottom';
}

// --------------------------------------------------------------------------- //
// Part B.4 — Fixed text bounds with proper margins                            //
// --------------------------------------------------------------------------- //

function buildTextSvg(brief: CompositionBrief, width: number, height: number, effectivePosition: string): Buffer {
  const color = brief.text_color || '#FFFFFF';
  const outline = brief.text_outline_color || '#000000';
  const primaryText = brief.text_primary;
  const secondaryText = brief.text_secondary || '';

  function fitFontSize(text: string, maxWidthPx: number, startSizePx: number): number {
    const approxW = (size: number) => text.length * size * 0.58;
    let s = startSizePx;
    while (approxW(s) > maxWidthPx && s > 18) s -= 2;
    return s;
  }

  const pad = Math.round(height * 0.06);
  const targetPrimary = Math.round(height * 0.20);
  // Pre-calculate stroke-width-aware margins so outlines don't clip
  const provisionalSize = targetPrimary;
  const provisionalStroke = Math.max(4, Math.round(provisionalSize * 0.08));
  const safeMargin = pad + provisionalStroke + 4;
  const maxTextWidth = width - safeMargin * 2;

  const primarySize = fitFontSize(primaryText, maxTextWidth, targetPrimary);
  const targetSecondary = Math.round(height * 0.08);
  const secondarySize = secondaryText ? fitFontSize(secondaryText, maxTextWidth, targetSecondary) : 0;
  const strokeWidth = Math.max(4, Math.round(primarySize * 0.08));

  let anchor: 'start' | 'middle' | 'end' = 'middle';
  let x = width / 2;
  let yPrimary = height / 2;

  switch (effectivePosition) {
    case 'top': anchor = 'middle'; x = width / 2; yPrimary = safeMargin + primarySize * 0.85; break;
    case 'bottom': anchor = 'middle'; x = width / 2; yPrimary = height - safeMargin; break;
    case 'top-left': anchor = 'start'; x = safeMargin; yPrimary = safeMargin + primarySize * 0.85; break;
    case 'top-right': anchor = 'end'; x = width - safeMargin; yPrimary = safeMargin + primarySize * 0.85; break;
    case 'bottom-left': anchor = 'start'; x = safeMargin; yPrimary = height - safeMargin; break;
    case 'bottom-right': anchor = 'end'; x = width - safeMargin; yPrimary = height - safeMargin; break;
    case 'center': default: anchor = 'middle'; x = width / 2; yPrimary = height / 2 + primarySize * 0.33;
  }

  const ySecondary = yPrimary + primarySize * 0.88;
  const primaryFont = `font-family="Impact, Arial Black, sans-serif" font-size="${primarySize}" font-weight="900"`;
  const secondaryFont = `font-family="Impact, Arial Black, sans-serif" font-size="${secondarySize}" font-weight="700"`;

  const pText = escapeXml(primaryText);
  const sText = escapeXml(secondaryText);

  const primaryStroke = `<text x="${x}" y="${yPrimary}" text-anchor="${anchor}" ${primaryFont} fill="none" stroke="${outline}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">${pText}</text>`;
  const primaryFill = `<text x="${x}" y="${yPrimary}" text-anchor="${anchor}" ${primaryFont} fill="${color}" filter="url(#shadow)">${pText}</text>`;
  const secondaryStroke = secondaryText
    ? `<text x="${x}" y="${ySecondary}" text-anchor="${anchor}" ${secondaryFont} fill="none" stroke="${outline}" stroke-width="${Math.max(2, Math.round(strokeWidth * 0.6))}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">${sText}</text>`
    : '';
  const secondaryFill = secondaryText
    ? `<text x="${x}" y="${ySecondary}" text-anchor="${anchor}" ${secondaryFont} fill="${color}" filter="url(#shadow)">${sText}</text>`
    : '';

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000" flood-opacity="0.90"/></filter></defs>${primaryStroke}${primaryFill}${secondaryStroke}${secondaryFill}</svg>`;
  return Buffer.from(svg);
}

// --------------------------------------------------------------------------- //
// Part B.5 — Subject layout builder (single / mirrored / triple with variation) //
// --------------------------------------------------------------------------- //

type PositionedSubject = {
  buffer: Buffer;
  shadow: Buffer;
  rimLight: Buffer;
  left: number;
  top: number;
  boundingBox: BoundingBox;
};

async function buildSubjectLayers(
  tightSubject: Buffer,
  layout: 'single' | 'mirrored' | 'triple',
  accentColor: string,
  warmTintColor: string
): Promise<PositionedSubject[]> {
  const subject = await warmTintSubject(tightSubject, warmTintColor, 0.06);

  if (layout === 'single') {
    const scaled = await sharp(subject).resize({ height: Math.round(TARGET_HEIGHT * 0.95), fit: 'inside' }).toBuffer();
    const meta = await sharp(scaled).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    const left = Math.max(0, Math.min(Math.round(TARGET_WIDTH * 0.60 - w / 2), TARGET_WIDTH - w));
    const top = TARGET_HEIGHT - h;
    const shadow = await buildSubjectShadow(scaled, 0.55);
    const rim = await buildRimLight(scaled, accentColor, 0.4);
    return [{
      buffer: scaled, shadow, rimLight: rim, left, top,
      boundingBox: await getSubjectBoundingBox(scaled, TARGET_WIDTH, TARGET_HEIGHT, left, top),
    }];
  }

  if (layout === 'mirrored') {
    const target = await sharp(subject).resize({ height: Math.round(TARGET_HEIGHT * 0.92), fit: 'inside' }).toBuffer();
    const meta = await sharp(target).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;

    const leftCopy = target;
    const rightCopy = await sharp(target).flop().toBuffer();

    const leftPosX = Math.round(TARGET_WIDTH * 0.22 - w / 2);
    const rightPosX = Math.round(TARGET_WIDTH * 0.78 - w / 2);
    const topY = TARGET_HEIGHT - h;

    const leftShadow = await buildSubjectShadow(leftCopy, 0.5);
    const rightShadow = await buildSubjectShadow(rightCopy, 0.5);
    const leftRim = await buildRimLight(leftCopy, accentColor, 0.35);
    const rightRim = await buildRimLight(rightCopy, accentColor, 0.35);

    return [
      {
        buffer: leftCopy, shadow: leftShadow, rimLight: leftRim,
        left: Math.max(-Math.round(w * 0.10), leftPosX), top: topY,
        boundingBox: await getSubjectBoundingBox(leftCopy, TARGET_WIDTH, TARGET_HEIGHT, leftPosX, topY),
      },
      {
        buffer: rightCopy, shadow: rightShadow, rimLight: rightRim,
        left: Math.min(TARGET_WIDTH - Math.round(w * 0.90), rightPosX), top: topY,
        boundingBox: await getSubjectBoundingBox(rightCopy, TARGET_WIDTH, TARGET_HEIGHT, rightPosX, topY),
      },
    ];
  }

  // triple — center biggest, two smaller sides, real overlap, all with shadows
  const centerTarget = await sharp(subject).resize({ height: Math.round(TARGET_HEIGHT * 0.98), fit: 'inside' }).toBuffer();
  const sideTarget = await sharp(subject).resize({ height: Math.round(TARGET_HEIGHT * 0.72), fit: 'inside' }).toBuffer();

  const centerMeta = await sharp(centerTarget).metadata();
  const sideMeta = await sharp(sideTarget).metadata();
  const cw = centerMeta.width || 0;
  const ch = centerMeta.height || 0;
  const sw = sideMeta.width || 0;
  const sh = sideMeta.height || 0;

  const leftSide = sideTarget;
  const rightSide = await sharp(sideTarget).flop().toBuffer();

  const leftPos = { left: Math.round(TARGET_WIDTH * 0.18 - sw / 2), top: TARGET_HEIGHT - sh };
  const rightPos = { left: Math.round(TARGET_WIDTH * 0.82 - sw / 2), top: TARGET_HEIGHT - sh };
  const centerPos = { left: Math.round(TARGET_WIDTH / 2 - cw / 2), top: TARGET_HEIGHT - ch };

  const [leftShadow, rightShadow, centerShadow] = await Promise.all([
    buildSubjectShadow(leftSide, 0.45),
    buildSubjectShadow(rightSide, 0.45),
    buildSubjectShadow(centerTarget, 0.55),
  ]);
  const [leftRim, rightRim, centerRim] = await Promise.all([
    buildRimLight(leftSide, accentColor, 0.3),
    buildRimLight(rightSide, accentColor, 0.3),
    buildRimLight(centerTarget, accentColor, 0.4),
  ]);

  return [
    { buffer: leftSide, shadow: leftShadow, rimLight: leftRim, ...leftPos,
      boundingBox: await getSubjectBoundingBox(leftSide, TARGET_WIDTH, TARGET_HEIGHT, leftPos.left, leftPos.top) },
    { buffer: rightSide, shadow: rightShadow, rimLight: rightRim, ...rightPos,
      boundingBox: await getSubjectBoundingBox(rightSide, TARGET_WIDTH, TARGET_HEIGHT, rightPos.left, rightPos.top) },
    { buffer: centerTarget, shadow: centerShadow, rimLight: centerRim, ...centerPos,
      boundingBox: await getSubjectBoundingBox(centerTarget, TARGET_WIDTH, TARGET_HEIGHT, centerPos.left, centerPos.top) },
  ];
}

// --------------------------------------------------------------------------- //
// Part C — Template polish pass (applied to final thumbnail)                  //
// --------------------------------------------------------------------------- //

async function polishPass(composite: Buffer): Promise<Buffer> {
  // Vignette overlay SVG
  const vignette = Buffer.from(
    `<svg width="${TARGET_WIDTH}" height="${TARGET_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="vg" cx="50%" cy="50%" r="75%">
          <stop offset="60%" stop-color="#000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.35"/>
        </radialGradient>
      </defs>
      <rect width="${TARGET_WIDTH}" height="${TARGET_HEIGHT}" fill="url(#vg)"/>
    </svg>`
  );

  return sharp(composite)
    // Slight warmth + saturation boost for that "polished" feel
    .modulate({ saturation: 1.12, brightness: 1.02 })
    .composite([{ input: vignette, blend: 'over' }])
    // Final sharpen for crispness
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();
}

// --------------------------------------------------------------------------- //
// Main composite function                                                     //
// --------------------------------------------------------------------------- //

function watermarkOffset(position: string | undefined, canvasW: number, canvasH: number, wmW: number, wmH: number): { left: number; top: number } {
  const pad = 24;
  switch (position) {
    case 'top-left': return { left: pad, top: pad };
    case 'top-right': return { left: canvasW - wmW - pad, top: pad };
    case 'bottom-left': return { left: pad, top: canvasH - wmH - pad };
    case 'center': return { left: Math.round((canvasW - wmW) / 2), top: Math.round((canvasH - wmH) / 2) };
    case 'bottom-right':
    default:
      return { left: canvasW - wmW - pad, top: canvasH - wmH - pad };
  }
}

export async function composite(input: CompositeInput): Promise<Buffer> {
  const { backgroundUrl, subjectMaskUrl, brief, watermarkUrl, watermarkPosition } = input;

  const [bgRaw, subjRaw] = await Promise.all([
    fetchBuffer(backgroundUrl),
    fetchBuffer(subjectMaskUrl),
  ]);

  // Background: slight burn (darken) so subject pops
  const background = await sharp(bgRaw)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'center' })
    .modulate({ brightness: 0.88 })  // dim background slightly
    .toBuffer();

  // Subject: tight crop + edge feather
  const tightSubject = await tightCropAndFeather(subjRaw);

  const layout = brief.layout || 'single';
  // Use text_outline_color as the rim light color for unified aesthetic, or text_color, or brief accent
  const accentColor = brief.text_color || '#FF1493';
  const warmTintColor = brief.text_color || '#FF69B4';

  const positioned = await buildSubjectLayers(tightSubject, layout, accentColor, warmTintColor);

  // Build layers: shadows first, then rim lights, then subjects, then text, then watermark
  const subjectBoxes = positioned.map((p) => p.boundingBox);

  // Decide effective text position based on subject heads
  const effectivePosition = pickSafeTextPosition(subjectBoxes, brief.text_position || 'bottom', TARGET_WIDTH, TARGET_HEIGHT);

  const textSvg = buildTextSvg(brief, TARGET_WIDTH, TARGET_HEIGHT, effectivePosition);

  const layers: sharp.OverlayOptions[] = [];

  // Shadows: offset slightly down and to the side
  for (const p of positioned) {
    layers.push({ input: p.shadow, left: p.left + 12, top: p.top + 18 });
  }
  // Subjects
  for (const p of positioned) {
    layers.push({ input: p.buffer, left: p.left, top: p.top });
  }
  // Rim lights on top of subjects
  for (const p of positioned) {
    layers.push({ input: p.rimLight, left: p.left, top: p.top, blend: 'screen' });
  }
  // Text
  layers.push({ input: textSvg, left: 0, top: 0 });

  // Watermark
  if (watermarkUrl) {
    const wmRaw = await fetchBuffer(watermarkUrl);
    const wmSized = await sharp(wmRaw)
      .resize({ width: Math.round(TARGET_WIDTH * 0.12), withoutEnlargement: true })
      .toBuffer();
    const wmMeta = await sharp(wmSized).metadata();
    const offset = watermarkOffset(watermarkPosition, TARGET_WIDTH, TARGET_HEIGHT, wmMeta.width || 0, wmMeta.height || 0);
    layers.push({ input: wmSized, left: offset.left, top: offset.top });
  }

  const rawComposite = await sharp(background).composite(layers).png().toBuffer();

  // Final polish pass (Option 4: template-driven)
  return polishPass(rawComposite);
}
