#!/usr/bin/env node
/**
 * Spec 069 FR-031: the token-to-art review page. One self-contained HTML file showing, for every icon
 * key, its file name, description, the proposed art at 12, 16 and 24 px on a
 * light and a dark background, where the art comes from, and the keys sharing it. The maintainer
 * signs this page off before any art enters the application.
 *
 *   node scripts/icon-review-page.mjs --lucide <unpacked lucide-static dir> --out <file.html>
 *
 * Reads packages/core/src/icons/default-set/SOURCES.json, the keys and descriptions from
 * packages/core/dist (build core first), and art drawn for throng from
 * specs/069-lucide-icon-set/review/drafts/<key>.svg.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = join(ROOT, 'packages/core/src/icons/default-set/SOURCES.json');
const DRAFTS = join(ROOT, 'specs/069-lucide-icon-set/review/drafts');

/** The pairs and families FR-009 requires to be visibly distinct, shown side by side. */
const FR009_GROUPS = [
  ['save', 'saveAs'],
  ['expand', 'collapse'],
  ['expandAll', 'collapseAll'],
  ['findNext', 'findPrevious'],
  ['moveUp', 'moveDown'],
  ['zoomIn', 'zoomOut', 'zoomReset'],
  ['folder', 'folderOpen'],
  ['windowMaximise', 'windowRestore'],
  ['panelMaximise', 'panelRestore'],
  ['undo', 'redo'],
  ['navigateBack', 'navigateForward'],
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function fail(message) {
  console.error(`icon-review-page: ${message}`);
  process.exit(1);
}

/** Strip the licence comment and the class Lucide adds; keep the drawing exactly. */
function clean(svg) {
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+class="[^"]*"/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const lucideDir = arg('--lucide');
const out = arg('--out');
if (!lucideDir || !out) fail('usage: --lucide <unpacked lucide-static dir> --out <file.html>');

const pkg = JSON.parse(readFileSync(join(lucideDir, 'package.json'), 'utf8'));
const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
if (pkg.version !== sources.lucideVersion) fail(`Lucide ${pkg.version} given, SOURCES.json pins ${sources.lucideVersion}`);

const core = await import(pathToFileURL(join(ROOT, 'packages/core/dist/index.js')).href);
const keys = [...core.ICON_KEYS];
const descriptions = core.ICON_KEY_DESCRIPTIONS;

const problems = [];
for (const key of keys) if (!sources.keys[key]) problems.push(`${key}: no entry in SOURCES.json`);
for (const key of Object.keys(sources.keys)) if (!keys.includes(key)) problems.push(`${key}: in SOURCES.json but not a key`);

const art = {};
for (const key of keys) {
  const entry = sources.keys[key];
  if (!entry) continue;
  const file = entry.lucide ? join(lucideDir, 'icons', `${entry.lucide}.svg`) : join(DRAFTS, `${key}.svg`);
  if (!existsSync(file)) {
    problems.push(`${key}: ${entry.lucide ? `Lucide has no "${entry.lucide}"` : 'no draft drawn'} (${file})`);
    continue;
  }
  art[key] = clean(readFileSync(file, 'utf8'));
}

const byArt = new Map();
for (const key of keys) {
  const id = sources.keys[key]?.lucide ?? `throng:${key}`;
  byArt.set(id, [...(byArt.get(id) ?? []), key]);
}
const sharing = (key) => (byArt.get(sources.keys[key]?.lucide ?? `throng:${key}`) ?? []).filter((k) => k !== key);
const declared = (key) => (sources.sameAction ?? []).some((group) => group.includes(key));
for (const key of keys) {
  if (sharing(key).length && !declared(key)) problems.push(`${key}: shares art with ${sharing(key).join(', ')} but is in no sameAction group`);
}

const specimens = (key) =>
  ['light', 'dark']
    .map(
      (scheme) =>
        `<div class="bg ${scheme}">${[12, 16, 24].map((px) => `<span class="ic" style="width:${px}px;height:${px}px">${art[key] ?? '?'}</span>`).join('')}</div>`,
    )
    .join('');

const origin = (key) => {
  const entry = sources.keys[key];
  if (!entry) return '<em>missing</em>';
  return entry.lucide ? `Lucide <code>${escapeHtml(entry.lucide)}</code>` : `Drawn for throng: ${escapeHtml(entry.throng)}`;
};

const rows = keys
  .map(
    (key, i) => `<tr id="${key}">
  <td class="n">${i + 1}</td>
  <td><code>${key}</code><br><code class="file">${key}.svg</code></td>
  <td>${specimens(key)}</td>
  <td>${escapeHtml(descriptions[key])}</td>
  <td>${origin(key)}${sharing(key).length ? `<br><span class="share">Shares art with ${sharing(key).map((k) => `<a href="#${k}">${k}</a>`).join(', ')}</span>` : ''}</td>
</tr>`,
  )
  .join('\n');

const pairs = FR009_GROUPS.map(
  (group) =>
    `<div class="pair">${group.map((key) => `<figure>${specimens(key)}<figcaption><code>${key}</code></figcaption></figure>`).join('')}</div>`,
).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Icon Mapping Review</title>
<style>
:root { --bg: #fbfbfa; --fg: #1d1d1f; --muted: #6b6b70; --line: #e2e2e0; --warn: #b3261e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #161618; --fg: #ececee; --muted: #9b9ba1; --line: #2c2c30; --warn: #f2b8b5; } }
:root[data-theme="dark"] { --bg: #161618; --fg: #ececee; --muted: #9b9ba1; --line: #2c2c30; --warn: #f2b8b5; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
main { max-width: 1280px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 32px 0 8px; }
p.lead { color: var(--muted); margin: 0 0 16px; max-width: 72ch; }
.problems { border: 1px solid var(--warn); color: var(--warn); padding: 8px 12px; border-radius: 6px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; min-width: 900px; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
th { position: sticky; top: 0; background: var(--bg); font-weight: 600; }
td.n { color: var(--muted); font-variant-numeric: tabular-nums; }
code.file { color: var(--muted); }
.share { color: var(--muted); font-size: 12px; }
.bg { display: inline-flex; gap: 10px; align-items: center; padding: 6px 10px; border-radius: 6px; margin: 0 6px 6px 0; }
.bg.light { background: #ffffff; color: #1f2328; border: 1px solid #d8d8d8; }
.bg.dark { background: #1e1e2e; color: #cdd6f4; }
.ic { display: inline-flex; } .ic svg { width: 100%; height: 100%; }
.pairs { display: flex; flex-wrap: wrap; gap: 16px; }
.pair { display: flex; gap: 8px; border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
figure { margin: 0; } figcaption { font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<main>
<h1>Icon mapping review — spec 069</h1>
<p class="lead">${keys.length} icon keys. Lucide ${escapeHtml(sources.lucideVersion)} (ISC; Feather-derived icons MIT). Each row shows the proposed art at 12, 16 and 24 px on a light and a dark background. Sign off the mapping, or name the keys to change.</p>
${problems.length ? `<div class="problems"><strong>${problems.length} problem(s):</strong><br>${problems.map(escapeHtml).join('<br>')}</div>` : ''}
<h2>Pairs that must look different (FR-009)</h2>
<div class="pairs">${pairs}</div>
<h2>Every key</h2>
<div class="table-wrap"><table>
<thead><tr><th>#</th><th>Key and file</th><th>Art</th><th>What it stands for</th><th>Origin</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
</main>
</body>
</html>
`;
writeFileSync(out, html);
console.log(`icon-review-page: ${keys.length} keys, ${problems.length} problem(s) → ${out}`);
if (problems.length) process.exitCode = 1;
