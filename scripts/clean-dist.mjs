// Remove the packaging output directory before a build (042 FR-013).
//
// Runs automatically as npm's `prepackage` hook. It exists because reconciliation is strict in BOTH
// directions: an artifact present that nobody declared fails the build, since a build whose output
// is not understood must not be published from.
//
// That strictness is right — it is what catches a target producing an unexpected filename — but it
// makes a stale local `dist/installer` fail a perfectly good build. Measured once: a
// `throng-setup-1.0.0-alpha2.exe` left over from a previous release failed the reconcile of a clean
// alpha3 build. CI never sees this, because a runner starts empty; a developer machine sees it
// every time. So the build starts from empty rather than the developer being told to remember.
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'dist', 'installer');

rmSync(outDir, { recursive: true, force: true });
console.log(`[clean-dist] removed ${outDir}`);
