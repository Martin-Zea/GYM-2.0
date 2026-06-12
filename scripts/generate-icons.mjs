import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const iconsDir = resolve(root, 'public/icons');

mkdirSync(iconsDir, { recursive: true });

const files = [
  { svg: 'gainai-icon.svg', prefix: 'gainai' },
  { svg: 'gainai-maskable.svg', prefix: 'gainai-maskable' },
];

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

for (const { svg, prefix } of files) {
  const svgPath = resolve(iconsDir, svg);
  const svgData = readFileSync(svgPath, 'utf-8');

  for (const size of sizes) {
    const resvg = new Resvg(svgData, {
      fitTo: { mode: 'width', value: size },
    });
    const png = resvg.render().asPng();
    const outPath = resolve(iconsDir, `${prefix}-${size}x${size}.png`);
    writeFileSync(outPath, png);
    console.log(`  ✓ ${prefix}-${size}x${size}.png`);
  }
}

console.log('\nDone.');
