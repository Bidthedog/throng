// Stamp packages/daemon/dist/BUILD_ID with a CONTENT hash of the daemon's built
// code. The UI compares this id against the running daemon's (health.ping) and
// restarts the daemon when they differ, so it never talks to stale daemon code
// (see packages/ui/src/main/daemon-lifecycle.ts).
//
// It MUST be a content hash, not a timestamp: the daemon is persistent and keeps
// terminals alive across app restarts (US3/FR-016). A timestamp would change on
// every build and force a needless restart — killing terminals — even when the
// daemon's code is byte-for-byte identical. A content hash changes ONLY when the
// code the daemon actually runs changes, so unchanged rebuilds reuse the running
// daemon (terminals persist) and real code changes retire it (no stale code).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every package whose compiled output the daemon process loads at runtime. A
// change in any of them (e.g. the node-pty kill path in platform-windows) must
// bump the id. The UI renderer is deliberately excluded — the daemon never loads
// it, so a renderer-only change should not restart the daemon.
const DAEMON_DIST_DIRS = ['core', 'ipc-contract', 'persistence', 'platform-windows', 'daemon'].map(
  (p) => join(repoRoot, 'packages', p, 'dist'),
);

/** All `.js` files under `dir`, recursively, as absolute paths (sorted-stable by caller). */
function jsFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // a package without built output yet — skip
  }
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(full));
    else if (e.name.endsWith('.js') && e.name !== 'BUILD_ID') out.push(full);
  }
  return out;
}

const files = DAEMON_DIST_DIRS.flatMap(jsFiles).sort();
const hash = createHash('sha256');
// Hash relative paths + contents so the id is stable across machines/checkouts
// (absolute paths would leak the working directory into the hash).
for (const file of files) {
  hash.update(file.slice(repoRoot.length).replace(/\\/g, '/'));
  hash.update('\0');
  hash.update(readFileSync(file));
  hash.update('\0');
}
const buildId = hash.digest('hex').slice(0, 16);

const target = join(repoRoot, 'packages', 'daemon', 'dist', 'BUILD_ID');
writeFileSync(target, buildId);
// Guard against an empty hash (no dist built): surface it rather than silently
// stamping the hash of "nothing", which would make every daemon look identical.
if (files.length === 0) {
  console.warn('[stamp-build] no daemon dist files found — did tsc run? BUILD_ID may be meaningless.');
}
console.log(`[stamp-build] BUILD_ID=${buildId} (${files.length} files)`);
