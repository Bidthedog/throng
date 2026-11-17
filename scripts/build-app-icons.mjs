#!/usr/bin/env node
/**
 * Regenerate the bundled application icons from the source SVGs (#72).
 *
 * This is a MAINTAINER script, deliberately NOT part of `npm run build`: it needs
 * Inkscape on the machine, which no build or CI box is required to have. Its
 * outputs (`packages/ui/assets/throng.ico`, `throng-256.png` and `throng-1024.png`) are COMMITTED, so
 * the app and CI just consume them. Re-run it whenever the artwork changes:
 *
 *     node scripts/build-app-icons.mjs          # inkscape must be on PATH
 *     INKSCAPE=/path/to/inkscape node scripts/build-app-icons.mjs
 *
 * Why several source SVGs: the 5x7 tile grid of `icon_large.svg` smears into blur
 * below ~48px, so 16, 24 and 32px each have a drawing on their own pixel grid
 * (`icon_16.svg`, `icon_24.svg`, `icon_small.svg`). An .ico is a container of independent images, which lets us put
 * the RIGHT ARTWORK in each size rather than downscaling one drawing everywhere —
 * Windows then picks the entry matching whatever it is about to render.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const iconDir = join(repoRoot, 'icon');
const outDir = join(repoRoot, 'packages', 'ui', 'assets');
const inkscape = process.env.INKSCAPE ?? 'inkscape';

/** The cut-over is the artwork's own brief: simplified at <=32px, detailed above. */
// The small sizes each have a drawing on their own pixel grid (icon_16, icon_24, icon_small at 32), so every
// tile edge lands on a whole pixel; the 1024 drawing scaled down to them smears the 5x7 grid into blur.
const SVG_16 = join(iconDir, 'icon_16.svg');
const SVG_24 = join(iconDir, 'icon_24.svg');
const SMALL_SVG = join(iconDir, 'icon_small.svg');
const LARGE_SVG = join(iconDir, 'icon_large.svg');
const SIZES = [
  { px: 16, svg: SVG_16 },
  { px: 24, svg: SVG_24 },
  { px: 32, svg: SMALL_SVG },
  { px: 48, svg: LARGE_SVG },
  { px: 64, svg: LARGE_SVG },
  { px: 128, svg: LARGE_SVG },
  { px: 256, svg: LARGE_SVG },
];

function rasterise(svg, px, destination) {
  execFileSync(
    inkscape,
    [
      svg,
      '--export-type=png',
      `--export-filename=${destination}`,
      `--export-width=${px}`,
      `--export-height=${px}`,
      '--export-background-opacity=0',
    ],
    { stdio: 'pipe' },
  );
  return readFileSync(destination);
}

/**
 * Pack PNGs into an ICO container.
 *
 * Layout: a 6-byte ICONDIR, then one 16-byte ICONDIRENTRY per image, then the
 * payloads. Entries may hold a raw PNG (Vista+ and every Chromium decoder), which
 * is why this needs no BMP encoder and no image library.
 */
function packIco(images) {
  const HEADER = 6;
  const ENTRY = 16;
  const directory = Buffer.alloc(HEADER + ENTRY * images.length);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // 1 = icon (2 would be a cursor)
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach(({ px, png }, i) => {
    const at = HEADER + i * ENTRY;
    // 256 is written as 0: the width/height fields are a single byte each.
    directory.writeUInt8(px >= 256 ? 0 : px, at);
    directory.writeUInt8(px >= 256 ? 0 : px, at + 1);
    directory.writeUInt8(0, at + 2); // palette size (0 = truecolour)
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([directory, ...images.map((image) => image.png)]);
}

const scratch = mkdtempSync(join(tmpdir(), 'throng-icons-'));
try {
  execFileSync(inkscape, ['--version'], { stdio: 'pipe' });
} catch {
  console.error(
    `Inkscape not found (tried "${inkscape}"). Install it, or set INKSCAPE to its full path.`,
  );
  process.exit(1);
}

try {
  mkdirSync(outDir, { recursive: true });
  const images = SIZES.map(({ px, svg }) => {
    const png = rasterise(svg, px, join(scratch, `throng-${px}.png`));
    console.log(`  ${String(px).padStart(3)}px  ${png.length.toLocaleString()} bytes  ${svg.split(/[\\/]/).pop()}`);
    return { px, png };
  });

  const ico = join(outDir, 'throng.ico');
  writeFileSync(ico, packIco(images));
  // The standalone PNG serves the platforms whose BrowserWindow `icon:` cannot read
  // an .ico (Linux), and is the obvious source for a future .icns.
  copyFileSync(join(scratch, 'throng-256.png'), join(outDir, 'throng-256.png'));
  // macOS (070): electron-builder turns a PNG of at least 512px into the .icns itself; 1024 is Retina's largest size.
  rasterise(LARGE_SVG, 1024, join(outDir, 'throng-1024.png'));

  console.log(`\nwrote ${ico} (${SIZES.length} sizes), throng-256.png and throng-1024.png`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
