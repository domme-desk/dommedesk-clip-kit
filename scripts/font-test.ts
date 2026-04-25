import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'fs';
import { loadAllFonts } from '../src/lib/pipeline/fonts';

async function main() {
  mkdirSync('/tmp/fonttest', { recursive: true });

  const fonts = loadAllFonts();
  console.log('Loaded fonts:');
  fonts.forEach(f => console.log(`  ${f.key} -> family="${f.family}", buffer=${f.buffer.length} bytes`));

  const fontsToTest = ['anton', 'pinyon-script', 'sacramento', 'abril-fatface', 'monoton', 'dancing-script'];

  for (const key of fontsToTest) {
    const font = fonts.find(f => f.key === key);
    if (!font) {
      console.log(`SKIP: ${key} not loaded`);
      continue;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200"><rect width="800" height="200" fill="#FF1493"/><text x="400" y="120" text-anchor="middle" font-family="${font.family}" font-size="80" fill="white" stroke="black" stroke-width="3">CHASTITY TASK</text></svg>`;

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 800 },
      font: {
        fontBuffers: fonts.map(f => f.buffer),
        loadSystemFonts: false,
        defaultFontFamily: 'sans-serif',
      },
    });

    const png = resvg.render().asPng();
    const filename = `/tmp/fonttest/${key}.png`;
    writeFileSync(filename, png);
    console.log(`Wrote ${filename} using family="${font.family}"`);
  }
}

main().catch(console.error);
