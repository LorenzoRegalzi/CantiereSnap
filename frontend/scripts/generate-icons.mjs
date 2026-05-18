/**
 * Converts the SVG placeholder icons to PNG for maximum browser/iOS compatibility.
 * Requires: npm install --save-dev sharp
 * Usage:   npm run generate-icons
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'public', 'icons');

const sizes = [192, 512];

for (const size of sizes) {
  const svg = readFileSync(join(iconsDir, `icon-${size}x${size}.svg`));
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(join(iconsDir, `icon-${size}x${size}.png`));
  console.log(`Generated icon-${size}x${size}.png`);
}
