#!/usr/bin/env node
/**
 * Generate `packages/core/src/icons/seeded-icon-history.generated.ts` (spec 069 FR-036, research R6).
 *
 * Every release up to alpha16 seeded two folders into the user's icon packs directory: `throng` (a
 * glyph manifest) and `throng-svg` (one SVG per icon token). The 069 upgrade deletes such a folder when
 * the user never touched it and backs it up otherwise, so it needs to know exactly which files, with
 * which contents, any of those releases wrote.
 *
 * For each `v1.0.0-alpha*` tag this script unpacks that tag's `packages/core/src` and
 * `packages/ui/src/main/icon-pack-service.ts` into a temporary directory OUTSIDE the repository,
 * transpiles the tag's own seeder with TypeScript, runs it against a second temporary directory, and records
 * the SHA-256 of every file written under `throng/` and `throng-svg/`. Tags whose output is identical
 * are merged into one entry. A tag whose seeder cannot be reproduced is skipped and named in the
 * generated file's header: a folder from that release then reads as customised and is backed up,
 * which is the safe direction.
 *
 * The output is frozen: seeding ends with spec 069, so the file is generated once and committed. Run
 * it again only to audit it:
 *
 *   node scripts/generate-seeded-icon-history.mjs            # rewrite the generated file
 *   node scripts/generate-seeded-icon-history.mjs --check    # fail if the file would change
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(repoRoot, 'packages/core/src/icons/seeded-icon-history.generated.ts');
const FOLDERS = ['throng', 'throng-svg'];
const SERVICE = 'packages/ui/src/main/icon-pack-service.ts';

const require = createRequire(path.join(repoRoot, 'package.json'));
const ts = require('typescript');

const git = (args, opts = {}) => execFileSync('git', args, { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024, ...opts });

function tags() {
  return git(['tag', '--list', 'v1.0.0-alpha*'])
    .toString()
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => Number(a.replace(/\D+/g, '')) - Number(b.replace(/\D+/g, '')));
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Files under dir, relative with forward slashes, sorted. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Every file under dir with the given extension, absolute. */
function walkAbs(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAbs(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Transpile every .ts under the unpacked tag to a sibling .js (ES modules, no type check). */
function transpileTree(root) {
  for (const file of walkAbs(root, '.ts')) {
    if (file.endsWith('.d.ts')) continue;
    const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
      fileName: file,
    });
    fs.writeFileSync(file.replace(/\.ts$/, '.js'), out.outputText);
  }
}

/** Run one tag's seeder; returns { throng: {file: sha}, 'throng-svg': {file: sha} }. */
async function seedTag(tag, work) {
  const src = path.join(work, 'src');
  fs.mkdirSync(src, { recursive: true });
  const archive = git(['archive', tag, 'packages/core/src', SERVICE]);
  execFileSync('tar', ['-x', '-C', src], { input: archive });
  transpileTree(src);
  // The tag's core imports third-party packages; resolve them from this checkout. Seeding never calls them.
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(src, 'node_modules'), 'dir');

  // The seeder imports '@throng/core'; point it at the tag's own core, which is where THRONG_THEME lives.
  const service = path.join(src, SERVICE.replace(/\.ts$/, '.js'));
  const core = path.join(src, 'packages/core/src/index.js');
  const rewritten = fs
    .readFileSync(service, 'utf8')
    .replaceAll("'@throng/core'", JSON.stringify(path.relative(path.dirname(service), core).split(path.sep).join('/')));
  fs.writeFileSync(service, rewritten);

  const entry = path.join(src, 'seed-entry.mjs');
  fs.writeFileSync(
    entry,
    `import { IconPackService } from './${SERVICE.replace(/\.ts$/, '.js')}';\n` +
      `await new IconPackService(process.argv[2]).ensureBundledPacks();\n`,
  );

  const target = path.join(work, 'icon-packs');
  fs.mkdirSync(target, { recursive: true });
  execFileSync(process.execPath, [entry, target], { stdio: ['ignore', 'pipe', 'pipe'] });

  const result = {};
  for (const folder of FOLDERS) {
    const dir = path.join(target, folder);
    if (!fs.existsSync(dir)) throw new Error(`the ${tag} seeder wrote no ${folder} folder`);
    const files = {};
    for (const rel of walk(dir)) files[rel] = sha256(fs.readFileSync(path.join(dir, rel)));
    if (Object.keys(files).length === 0) throw new Error(`the ${tag} seeder wrote no files into ${folder}`);
    result[folder] = files;
  }
  return result;
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

async function main() {
  const check = process.argv.includes('--check');
  const verifyIndex = process.argv.indexOf('--verify-ref');
  if (verifyIndex >= 0) {
    // Audit: does the seeder at <ref> (for example HEAD, before 069 deleted it) still write what the
    // newest tag wrote? Exit 1 when it differs.
    const ref = process.argv[verifyIndex + 1];
    const latest = tags().at(-1);
    const dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'throng-seed-')), fs.mkdtempSync(path.join(os.tmpdir(), 'throng-seed-'))];
    try {
      const [a, b] = [await seedTag(latest, dirs[0]), await seedTag(ref, dirs[1])];
      const same = JSON.stringify(a) === JSON.stringify(b);
      console.log(`${ref} ${same ? 'matches' : 'DIFFERS from'} ${latest}`);
      process.exit(same ? 0 : 1);
    } finally {
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    }
  }
  const reproduced = [];
  const skipped = [];
  for (const tag of tags()) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'throng-seed-'));
    try {
      reproduced.push({ tag, folders: await seedTag(tag, work) });
    } catch (error) {
      const stderr = error?.stderr?.toString().trim().split('\n').filter((l) => /Error/.test(l)).pop();
      skipped.push({ tag, reason: String(stderr ?? error?.message ?? error).split('\n')[0] });
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  // Merge tags that wrote the same bytes, per folder.
  const history = {};
  for (const folder of FOLDERS) {
    const byKey = new Map();
    for (const { tag, folders } of reproduced) {
      const files = sorted(folders[folder]);
      const key = JSON.stringify(files);
      const existing = byKey.get(key);
      if (existing) existing.tags.push(tag);
      else byKey.set(key, { tags: [tag], files });
    }
    history[folder] = [...byKey.values()];
  }

  const lines = [];
  lines.push('/**');
  lines.push(' * GENERATED by scripts/generate-seeded-icon-history.mjs. DO NOT EDIT. FROZEN (spec 069 FR-036, research R6).');
  lines.push(' *');
  lines.push(' * What every release up to alpha16 seeded into the user\'s icon packs directory, as the SHA-256 of each file,');
  lines.push(' * one entry per distinct set of files. The upgrade deletes a seeded folder only when it matches one entry');
  lines.push(' * exactly (same file names, same hashes). Seeding ends with spec 069, so this never needs regenerating.');
  lines.push(' *');
  lines.push(` * Reproduced: ${reproduced.map((r) => r.tag).join(', ') || 'none'}.`);
  if (skipped.length === 0) {
    lines.push(' * Skipped: none.');
  } else {
    lines.push(' * Skipped (the seeder could not be reproduced, so a folder from that release reads as customised and is backed up):');
    for (const s of skipped) lines.push(` *   ${s.tag}: ${s.reason}`);
  }
  lines.push(' */');
  lines.push('');
  lines.push('/** One set of files some release seeded into a folder: file name to SHA-256, and the tags that wrote exactly it. */');
  lines.push('export interface SeededVersion {');
  lines.push('  readonly tags: readonly string[];');
  lines.push('  readonly files: Readonly<Record<string, string>>;');
  lines.push('}');
  lines.push('');
  lines.push("export type SeededFolderName = 'throng' | 'throng-svg';");
  lines.push('');
  lines.push('export const SEEDED_ICON_HISTORY: Readonly<Record<SeededFolderName, readonly SeededVersion[]>> = {');
  for (const folder of FOLDERS) {
    lines.push(`  '${folder}': [`);
    for (const version of history[folder]) {
      lines.push('    {');
      lines.push(`      tags: ${JSON.stringify(version.tags)},`);
      lines.push('      files: {');
      for (const [file, hash] of Object.entries(version.files)) lines.push(`        ${JSON.stringify(file)}: '${hash}',`);
      lines.push('      },');
      lines.push('    },');
    }
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');
  const text = lines.join('\n');

  if (check) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== text) {
      console.error('seeded-icon-history.generated.ts is out of date with the release tags');
      process.exit(1);
    }
    console.log('seeded-icon-history.generated.ts is current');
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(repoRoot, OUT)}: ${reproduced.length} tags reproduced, ${skipped.length} skipped`);
  for (const s of skipped) console.log(`  skipped ${s.tag}: ${s.reason}`);
}

await main();
