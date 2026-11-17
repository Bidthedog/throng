#!/usr/bin/env node
/**
 * Regenerates the website's raster icons and social card from site/assets/icon.svg (064 FR-001).
 *
 * A MAINTAINER script, like build-app-icons.mjs: it renders with Playwright's Chromium, and its outputs are committed,
 * so the Pages deployment needs neither. Re-run it whenever the icon or the headline changes:
 *
 *     node scripts/site-icons.mjs
 *
 * Writes site/favicon.ico (16, 32, 48), site/assets/apple-touch-icon.png (180), site/assets/icon-192.png,
 * site/assets/icon-512.png and site/assets/social-card.png (1200x630, the og:image).
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const site = join(root, 'site');
const { chromium } = createRequire(join(root, 'package.json'))('playwright');

const dataUrl = (path) => `data:image/svg+xml;base64,${readFileSync(path).toString('base64')}`;
const svgUrl = dataUrl(join(site, 'assets', 'icon.svg'));
// 16 and 32px use the app's pixel-grid drawings (icon/), so the favicon stays sharp rather than a scaled-down blur.
const pixelArt = { 16: dataUrl(join(root, 'icon', 'icon_16.svg')), 32: dataUrl(join(root, 'icon', 'icon_small.svg')) };
const font = (file) => `data:font/woff2;base64,${readFileSync(join(site, 'assets', 'fonts', file)).toString('base64')}`;

/** Packs PNGs into an ICO container (PNG-compressed entries, Vista and later). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ px, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(px >= 256 ? 0 : px, at);
    header.writeUInt8(px >= 256 ? 0 : px, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const render = async (px) => {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${pixelArt[px] ?? svgUrl}" width="${px}" height="${px}"></body></html>`);
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
  };

  const entries = [];
  for (const px of [16, 32, 48]) entries.push({ px, png: await render(px) });
  writeFileSync(join(site, 'favicon.ico'), ico(entries));
  writeFileSync(join(site, 'assets', 'apple-touch-icon.png'), await render(180));
  writeFileSync(join(site, 'assets', 'icon-192.png'), await render(192));
  writeFileSync(join(site, 'assets', 'icon-512.png'), await render(512));

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<html><head><style>
    @font-face { font-family: S; font-weight: 400 800; src: url(${font('schibsted-grotesk-latin-var.woff2')}) format('woff2'); }
    body { margin: 0; width: 1200px; height: 630px; background: #172033; color: #e8edf5; font-family: S, sans-serif;
      display: flex; align-items: center; gap: 64px; padding: 0 88px; box-sizing: border-box; }
    img { width: 280px; height: 280px; flex: none; }
    h1 { font-size: 76px; line-height: 1.02; letter-spacing: -0.035em; margin: 0 0 22px; font-weight: 800; }
    p { font-size: 30px; color: #9fb0c8; margin: 0; }
  </style></head><body><img src="${svgUrl}"><div><h1>Every project, every terminal, one window.</h1>
    <p>throng-ide.com · Windows, Linux and macOS</p></div></body></html>`);
  await page.evaluate('document.fonts.ready');
  writeFileSync(join(site, 'assets', 'social-card.png'), await page.screenshot());
} finally {
  await browser.close();
}
console.log('[site-icons] favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, social-card.png');
