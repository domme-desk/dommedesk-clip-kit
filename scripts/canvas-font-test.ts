import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';

mkdirSync('/tmp/canvastest', { recursive: true });

const FONTS_DIR = path.join(process.cwd(), 'src/assets/fonts');

const fonts = [
  { key: 'anton', file: 'Anton-Regular.ttf', family: 'Anton' },
  { key: 'pinyon-script', file: 'PinyonScript-Regular.ttf', family: 'Pinyon Script' },
  { key: 'sacramento', file: 'Sacramento-Regular.ttf', family: 'Sacramento' },
  { key: 'abril-fatface', file: 'AbrilFatface-Regular.ttf', family: 'Abril Fatface' },
  { key: 'monoton', file: 'Monoton-Regular.ttf', family: 'Monoton' },
  { key: 'dancing-script', file: 'DancingScript-Regular.ttf', family: 'Dancing Script' },
];

// Register all fonts
for (const f of fonts) {
  const fontPath = path.join(FONTS_DIR, f.file);
  const success = GlobalFonts.registerFromPath(fontPath, f.family);
  console.log(`Register ${f.family}: ${success ? 'OK' : 'FAIL'}`);
}

// Render test for each font
for (const f of fonts) {
  const canvas = createCanvas(800, 200);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FF1493';
  ctx.fillRect(0, 0, 800, 200);

  ctx.font = `80px "${f.family}"`;
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const text = 'CHASTITY TASK';
  ctx.strokeText(text, 400, 110);
  ctx.fillText(text, 400, 110);

  const buf = canvas.toBuffer('image/png');
  const out = `/tmp/canvastest/${f.key}.png`;
  writeFileSync(out, buf);
  console.log(`Wrote ${out}`);
}
