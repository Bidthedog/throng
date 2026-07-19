// Stage the bundled Node.js runtime for the installer (020 FR-009).
//
// The daemon runs on HOST Node, not Electron's Node, because its native modules
// (better-sqlite3, node-pty, koffi) are compiled against the host-Node ABI ("no
// electron-rebuild"). A self-contained install therefore ships a `node.exe` and spawns the
// daemon with it (see packages/ui/src/main/daemon-lifecycle.ts).
//
// We stage the EXACT node binary that ran this build (`process.execPath`), because that is the
// binary whose ABI the freshly-installed native modules were built against — copying it
// guarantees the bundled runtime and the natives match. The release build therefore pins the
// runtime to whatever Node the release is built with (recorded in the release notes).
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'packages', 'ui', 'build', 'resources', 'runtime');
const outExe = join(outDir, 'node.exe');

mkdirSync(outDir, { recursive: true });

const source = process.execPath; // the node.exe running this script
if (!existsSync(source)) {
  console.error(`[stage-runtime] cannot find the running node binary at ${source}`);
  process.exit(1);
}
// Must be a real Node, not Electron running as node (ELECTRON_RUN_AS_NODE) — that would bundle
// electron.exe as the daemon runtime with the wrong ABI. Run `npm run stage:runtime` under plain node.
if (process.versions.electron) {
  console.error('[stage-runtime] refusing to stage: running under Electron, not plain Node. Run with node.');
  process.exit(1);
}
copyFileSync(source, outExe);

// Record the EXACT runtime version + arch alongside the binary (T002, supports SC-008
// reproducibility). It ships with the runtime (extraResources → resources/runtime/) so a release
// records precisely which Node build it bundled; a rebuild from the same source + this version
// produces the same bundled runtime.
const record = { version: process.version, arch: process.arch, platform: process.platform };
writeFileSync(join(outDir, 'RUNTIME_VERSION.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`[stage-runtime] bundled ${process.version} (${process.arch}) runtime → ${outExe}`);
