// One-shot script: upload all PNGs from public/composer-references/
// into Supabase Storage at assets/composer-references/, then print URLs.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { uploadFile } from '@/lib/supabase/storage';

async function main() {
  const localDir = join(process.cwd(), 'public', 'composer-references');
  const files = readdirSync(localDir).filter((f) => f.endsWith('.png'));

  if (files.length === 0) {
    console.error('❌ No PNG files found in public/composer-references/');
    process.exit(1);
  }

  console.log(`Found ${files.length} files. Uploading to Supabase...\n`);

  const urls: { name: string; url: string }[] = [];

  for (const file of files) {
    const localPath = join(localDir, file);
    const buffer = readFileSync(localPath);
    const remotePath = `composer-references/${file}`;

    const result = await uploadFile(remotePath, buffer, 'image/png');

    if ('error' in result) {
      console.error(`❌ ${file}: ${result.error}`);
      continue;
    }

    console.log(`✅ ${file}`);
    urls.push({ name: file, url: result.url });
  }

  console.log('\n=== Hardcode these URLs in composer.ts ===\n');
  console.log('const ASPIRATIONAL_REFERENCES = [');
  for (const { url } of urls) {
    console.log(`  '${url}',`);
  }
  console.log('];');
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
