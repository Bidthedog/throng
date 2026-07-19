// Stamp packages/daemon/dist/VERSION with the product version — the SINGLE authoritative
// value from the root package.json (020 FR-001/FR-004/FR-005). The daemon does not read the
// root package.json at runtime (it is spawned standalone), so the version is baked next to its
// built code, mirroring stamp-build.mjs's BUILD_ID.
//
// This is DISTINCT from BUILD_ID (020 FR-006): BUILD_ID is a content hash that detects a stale
// daemon; VERSION identifies the release. Two builds of one version share VERSION but differ in
// BUILD_ID. Keep them separate.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const version = rootPkg.version;

if (typeof version !== 'string' || version.trim() === '') {
  console.error('[generate-version] root package.json has no usable "version" — refusing to stamp.');
  process.exit(1);
}

const target = join(repoRoot, 'packages', 'daemon', 'dist', 'VERSION');
try {
  writeFileSync(target, version);
  console.log(`[generate-version] VERSION=${version} → packages/daemon/dist/VERSION`);
} catch (err) {
  // The daemon dist may not exist yet on a fresh checkout before tsc runs; surface it rather
  // than failing the whole build silently.
  console.warn(`[generate-version] could not write ${target}: ${err instanceof Error ? err.message : err}`);
}
