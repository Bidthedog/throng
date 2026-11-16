#!/usr/bin/env node
/**
 * Spec 069 (research R1, R4): copy the signed-off default icon set into the repository.
 *
 *   node scripts/vendor-lucide-icons.mjs <unpacked lucide-static dir>
 *
 * For every key in packages/core/src/icons/default-set/SOURCES.json it writes
 * packages/core/src/icons/default-set/<key>.svg: the named Lucide icon for a `lucide` entry, or the
 * reviewed drawing in specs/069-lucide-icon-set/review/drafts/<key>.svg for a `throng` entry. Each
 * file is passed through the same sanitiser the app uses, so what is vendored is exactly what the
 * app draws. The package's LICENSE is copied beside the art (FR-022). Run only after the mapping is
 * signed off (FR-031). Build core first: it imports the key list and the sanitiser from
 * packages/core/dist.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SET_DIR = join(ROOT, 'packages/core/src/icons/default-set');
const DRAFTS = join(ROOT, 'specs/069-lucide-icon-set/review/drafts');

function fail(message) {
  console.error(`vendor-lucide-icons: ${message}`);
  process.exit(1);
}

const lucideDir = process.argv[2];
if (!lucideDir) fail('usage: node scripts/vendor-lucide-icons.mjs <unpacked lucide-static dir>');

const sources = JSON.parse(readFileSync(join(SET_DIR, 'SOURCES.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(lucideDir, 'package.json'), 'utf8'));
if (pkg.name !== 'lucide-static' || pkg.version !== sources.lucideVersion) {
  fail(`expected lucide-static ${sources.lucideVersion}, found ${pkg.name} ${pkg.version}`);
}

const licence = readFileSync(join(lucideDir, 'LICENSE'), 'utf8');
if (!licence.startsWith('ISC License')) fail('the package LICENSE no longer starts with "ISC License"');
if (!licence.includes('The MIT License (MIT)') || !licence.includes('Feather')) {
  fail('the package LICENSE no longer carries the Feather MIT notice');
}

const core = await import(pathToFileURL(join(ROOT, 'packages/core/dist/index.js')).href);
const missing = [];
let written = 0;
for (const key of core.ICON_KEYS) {
  const entry = sources.keys[key];
  if (!entry) {
    missing.push(`${key}: no SOURCES.json entry`);
    continue;
  }
  const from = entry.lucide ? join(lucideDir, 'icons', `${entry.lucide}.svg`) : join(DRAFTS, `${key}.svg`);
  if (!existsSync(from)) {
    missing.push(`${key}: ${from} does not exist`);
    continue;
  }
  const raw = readFileSync(from, 'utf8').replace(/\s+class="[^"]*"/, '');
  const markup = core.sanitiseSvg(raw);
  if (!markup) {
    missing.push(`${key}: the sanitiser rejected ${from}`);
    continue;
  }
  writeFileSync(join(SET_DIR, `${key}.svg`), `${markup.trim()}\n`);
  written += 1;
}
if (missing.length) fail(`${missing.length} key(s) left without art:\n  ${missing.join('\n  ')}`);

writeFileSync(join(SET_DIR, 'LICENSE'), licence.endsWith('\n') ? licence : `${licence}\n`);
console.log(`vendor-lucide-icons: ${written} icons and LICENSE from lucide-static ${pkg.version}`);
