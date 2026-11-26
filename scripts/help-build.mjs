// Builds the guide that ships with throng (080 FR-049): the same builder over the same source as the website's
// guide, the site assets its pages load, and a Pagefind index, into one folder the Help window serves through the
// read-only `throng-help:` scheme. The home page is not shipped: its links leave the Help window for the website.
//
//   node scripts/help-build.mjs --out <dir>      `npm run build` runs it into packages/ui/dist/help
//
// The version stamped is the app's own, so Help always names the build it ships with.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGuide } from './guide-build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What the shipped pages load beside themselves; the home page's screenshots are left behind. */
const SITE_FILES = ['favicon.ico', 'site.webmanifest'];
const ASSET_FILES = ['site.css', 'site.js', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon.svg', 'logo.svg', 'fonts'];

export async function buildHelpBundle({
  out,
  version,
  siteSource = join(ROOT, 'site'),
  guideSource = join(siteSource, 'guide'),
  docsSource = join(ROOT, 'docs'),
  repoRoot = ROOT,
}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  for (const file of SITE_FILES) {
    if (existsSync(join(siteSource, file))) cpSync(join(siteSource, file), join(out, file));
  }
  for (const file of ASSET_FILES) {
    const from = join(siteSource, 'assets', file);
    if (existsSync(from)) cpSync(from, join(out, 'assets', file), { recursive: true });
  }
  await buildGuide({
    guideSource,
    docsSource,
    siteIndexHtml: readFileSync(join(siteSource, 'index.html'), 'utf8'),
    out,
    version,
    // A build of the app may be ahead of any tag, so repository links point at master.
    tag: 'master',
    // FR-066 — the sitemap is the website's, not the guide's.
    sitemap: false,
    repoRoot,
  });
  // Search runs offline: Pagefind's index is written beside the pages (only data-pagefind-body pages are indexed).
  const pagefind = await import('pagefind');
  const { index, errors } = await pagefind.createIndex({});
  if (errors.length > 0) throw new Error(`pagefind: ${errors.join('; ')}`);
  const added = await index.addDirectory({ path: out });
  if (added.errors.length > 0) throw new Error(`pagefind: ${added.errors.join('; ')}`);
  const written = await index.writeFiles({ outputPath: join(out, 'pagefind') });
  if (written.errors.length > 0) throw new Error(`pagefind: ${written.errors.join('; ')}`);
  await pagefind.close();
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const i = process.argv.indexOf('--out');
  if (i === -1 || !process.argv[i + 1]) throw new Error('usage: help-build.mjs --out <dir>');
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  await buildHelpBundle({ out: resolve(process.argv[i + 1]), version });
  console.log(`[help] built the guide for throng ${version} into ${process.argv[i + 1]}`);
}
