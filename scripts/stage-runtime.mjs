// Stage the bundled Node.js runtime for the installer (020 FR-009).
//
// The daemon runs on HOST Node, not Electron's Node, because its native modules
// (better-sqlite3, node-pty, koffi) are compiled against the host-Node ABI ("no
// electron-rebuild"). A self-contained install therefore ships a `node.exe` (`node` on Linux) and
// spawns the daemon with it (see packages/ui/src/main/daemon-lifecycle.ts).
//
// We stage the EXACT node binary that ran this build (`process.execPath`), because that is the
// binary whose ABI the freshly-installed native modules were built against — copying it
// guarantees the bundled runtime and the natives match. The release build therefore pins the
// runtime to whatever Node the release is built with (recorded in the release notes).
import { chmodSync, copyFileSync, mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'packages', 'ui', 'build', 'resources', 'runtime');
const outExe = join(outDir, process.platform === 'win32' ? 'node.exe' : 'node');

mkdirSync(outDir, { recursive: true });

const source = process.execPath; // the node binary running this script
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
// A distribution's node is a small stub over its own libnode, so it would not run anywhere else (063 FR-002). The
// release job's setup-node binary is the whole runtime. Measured: Ubuntu 26.04's /usr/bin/node is 27 KB.
if (process.platform === 'linux' && statSync(source).size < 10 * 1024 * 1024) {
  console.error(
    `[stage-runtime] refusing to stage ${source}: it is not a self-contained node. Use an official build, such as nvm's.`,
  );
  process.exit(1);
}
copyFileSync(source, outExe);
chmodSync(outExe, 0o755);

// Record the EXACT runtime version + arch alongside the binary (T002, supports SC-008
// reproducibility). It ships with the runtime (extraResources → resources/runtime/) so a release
// records precisely which Node build it bundled; a rebuild from the same source + this version
// produces the same bundled runtime.
const record = { version: process.version, arch: process.arch, platform: process.platform };
writeFileSync(join(outDir, 'RUNTIME_VERSION.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`[stage-runtime] bundled ${process.version} (${process.arch}) runtime → ${outExe}`);

// Stage the "who is using this installation" helper pair (058 FR-016a, research D9). The setup
// `File`s them (packaging/installer.nsh) and electron-builder.yml ships them to resources/in-use/,
// and the MSI's in-use custom action runs the same pair with the installed runtime. The names are
// exact: the NSIS compile fails without them. `install-in-use.js` is core's compiled classifier, so
// core must be built first — `npm run package` builds before it stages.
const inUseDir = join(repoRoot, 'packages', 'ui', 'build', 'resources', 'in-use');
const classifier = join(repoRoot, 'packages', 'core', 'dist', 'config', 'install-in-use.js');
if (!existsSync(classifier)) {
  console.error(`[stage-runtime] ${classifier} is missing — build @throng/core first (npm run build).`);
  process.exit(1);
}
mkdirSync(inUseDir, { recursive: true });
copyFileSync(join(repoRoot, 'packaging', 'in-use.mjs'), join(inUseDir, 'in-use.mjs'));
copyFileSync(join(repoRoot, 'packaging', 'in-use-cli.mjs'), join(inUseDir, 'in-use-cli.mjs'));
copyFileSync(classifier, join(inUseDir, 'in-use-classify.js'));
console.log(`[stage-runtime] staged the in-use helper → ${inUseDir}`);

// 063 research D5 — a package's scripts know their own version. electron-builder's macros cannot supply
// it to the scripts it passes through to fpm, so the copies it reads carry it already. dpkg and rpm
// spell a prerelease with a tilde, which is what electron-builder records as the package's version.
if (process.platform === 'linux') {
  const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  const scriptsOut = join(repoRoot, 'packages', 'ui', 'build', 'linux');
  mkdirSync(scriptsOut, { recursive: true });
  for (const name of ['before-install.sh', 'after-install.sh', 'before-remove.sh', 'after-remove.sh']) {
    const text = readFileSync(join(repoRoot, 'packaging', 'linux', name), 'utf8')
      .replaceAll('@VERSION@', version)
      .replaceAll('@PACKAGE_VERSION@', version.replaceAll('-', '~'));
    writeFileSync(join(scriptsOut, name), text, { mode: 0o755 });
  }
  console.log(`[stage-runtime] staged the package scripts for ${version} → ${scriptsOut}`);
}
