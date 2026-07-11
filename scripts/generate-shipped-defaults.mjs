// Build-time materialisation of the shipped-defaults record (feature 010).
//
// The authoritative record is the in-process `buildShippedDefaults()` in
// @throng/core (generated from the theme/settings/keybinding definitions). This
// script writes the same record to a JSON artifact packaged with the build, for
// distribution and inspection. Runtime does NOT depend on this file — it consumes
// the in-process record — so the app still works if the JSON is absent; the
// fidelity contract test guarantees this JSON equals the in-process record.
//
// Run after `tsc -b` (needs packages/core/dist). Wired into the root `build`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeShippedDefaults } from '../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../packages/ui/dist/main/shipped-defaults.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, serializeShippedDefaults(), 'utf8');
console.log(`[shipped-defaults] wrote ${out}`);
