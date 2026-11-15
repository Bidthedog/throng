// electron-builder's afterSign hook for macOS (070 FR-004, FR-044, research R23). It runs for every platform's build and
// does nothing off macOS. CommonJS because electron-builder `require()`s a hook.
//
// Apple silicon runs no code that is not signed, and these copies are signed ad hoc (`identity: "-"`), with no
// developer identity. electron-builder signs Electron's own binaries; this makes sure EVERY executable and native
// library throng ships carries a signature too, the bundled runtime and the natives it loads above all, then fails the
// build on any binary a Mac would refuse to run:
//
//   1. find every Mach-O file in the bundle, by its magic number, not by its name, and give the programs throng
//      executes (the runtime `node`, node-pty's `spawn-helper`) their execute bit: node-pty's package ships
//      `spawn-helper` as 0644, and without the bit every terminal fails to start (posix_spawn EACCES);
//   2. ad-hoc sign each one under Contents/Resources (the runtime `node`, every `.node` addon, node-pty's
//      `spawn-helper`, koffi's library), then re-seal the bundle, whose seal covers those files' bytes;
//   3. `codesign --verify --deep --strict` the bundle, and `codesign --verify` each Mach-O on its own: --deep follows
//      nested code, not a loose binary in Resources, and an unsigned one there is exactly what macOS kills at exec;
//   4. `lipo -archs` every Mach-O: each must include arm64, since no Intel copy is made (FR-003).
//
// Also a CLI, for checking a built bundle by hand:  node packaging/macos/after-sign.cjs <throng.app>   (exit 1 on any
// failure, naming each).
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require('node:child_process');
const { chmodSync, closeSync, lstatSync, openSync, readSync, readdirSync } = require('node:fs');
const { join, relative, sep } = require('node:path');
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The first four bytes of a Mach-O file, read big-endian. From <mach-o/loader.h> (MH_MAGIC, MH_CIGAM, MH_MAGIC_64,
 * MH_CIGAM_64) and <mach-o/fat.h> (FAT_MAGIC, FAT_CIGAM, FAT_MAGIC_64, FAT_CIGAM_64). The CIGAM forms are the same
 * magic written in the other byte order.
 */
const THIN_MAGIC = [0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe];
const FAT_MAGIC = [0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca];

/**
 * A universal ("fat") file shares 0xcafebabe with a Java class file. A fat header's next word is its architecture
 * count, which is small; a class file's is its version, whose major half is 45 or more. <mach-o/fat.h>: `nfat_arch`.
 */
const MAX_FAT_ARCHES = 20;

/** Does a file that begins with these bytes hold Mach-O code? */
function isMachOHeader(head) {
  if (head.length < 4) return false;
  const magic = head.readUInt32BE(0);
  if (THIN_MAGIC.includes(magic)) return true;
  if (!FAT_MAGIC.includes(magic) || head.length < 8) return false;
  const big = magic === 0xcafebabe || magic === 0xcafebabf;
  const arches = big ? head.readUInt32BE(4) : head.readUInt32LE(4);
  return arches > 0 && arches <= MAX_FAT_ARCHES;
}

function readHead(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(8);
    const read = readSync(fd, head, 0, 8, 0);
    return head.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** Every Mach-O file under `root`, sorted. Symbolic links are not followed: a framework's links point inside it. */
function findMachOFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && lstatSync(path).size >= 4 && isMachOHeader(readHead(path))) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

/** What must be in every copy, relative to the bundle: without these the daemon cannot start (FR-004). */
const REQUIRED = [
  { what: 'the bundled Node runtime', test: (rel) => rel === 'Contents/Resources/runtime/node', program: true },
  { what: "node-pty's spawn-helper", test: (rel) => /\/node-pty\/prebuilds\/darwin-arm64\/spawn-helper$/.test(rel), program: true },
  { what: "node-pty's addon", test: (rel) => /\/node-pty\/prebuilds\/darwin-arm64\/pty\.node$/.test(rel) },
  { what: "better-sqlite3's addon", test: (rel) => /\/better-sqlite3\/prebuilds\/darwin-arm64\.node$/.test(rel) },
  { what: "koffi's library", test: (rel) => /\/koffi(?:-darwin-arm64)?\/.*\.node$/.test(rel) },
];

const defaultExec = (file, args) => {
  const result = spawnSync(file, args, { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? String(result.error ?? '') };
};

/**
 * Sign and check one bundle. Answers every failure found, each a sentence naming the file; empty means the bundle is
 * fit to ship. Nothing is thrown, so one bad file does not hide the next.
 *
 * @param {string} app the `.app` folder
 * @param {{exec?: (file: string, args: string[]) => {status: number, stdout: string, stderr: string},
 *          log?: (line: string) => void}} [io] injected for tests
 * @returns {string[]}
 */
function signAndCheck(app, { exec = defaultExec, log = (line) => console.log(`[after-sign] ${line}`) } = {}) {
  const failures = [];
  const machOs = findMachOFiles(app);
  const rel = (path) => relative(app, path).split(sep).join('/');
  log(`${machOs.length} Mach-O file(s) in ${app}`);

  for (const { what, test, program } of REQUIRED) {
    const found = machOs.filter((path) => test(rel(path)));
    if (found.length === 0) failures.push(`${what} is missing from the bundle`);
    if (!program) continue;
    for (const path of found) {
      const mode = lstatSync(path).mode & 0o777;
      if ((mode & 0o111) === 0o111) continue;
      chmodSync(path, mode | 0o755);
      log(`${rel(path)}: made executable (was ${mode.toString(8)})`);
    }
  }

  const ours = machOs.filter((path) => rel(path).startsWith('Contents/Resources/'));
  for (const path of ours) {
    const signed = exec('codesign', ['--force', '--sign', '-', '--timestamp=none', path]);
    if (signed.status !== 0) failures.push(`${rel(path)}: codesign failed: ${signed.stderr.trim()}`);
  }
  // The bundle's seal records every resource's hash, so it must be made again after the files under it changed.
  const sealed = exec('codesign', ['--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=entitlements,requirements,flags,runtime', app]);
  if (sealed.status !== 0) failures.push(`${rel(app) || app}: re-sealing the bundle failed: ${sealed.stderr.trim()}`);

  const bundle = exec('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  if (bundle.status !== 0) failures.push(`the bundle does not verify: ${bundle.stderr.trim()}`);

  for (const path of machOs) {
    const verified = exec('codesign', ['--verify', '--strict', path]);
    if (verified.status !== 0) failures.push(`${rel(path)}: not validly signed: ${verified.stderr.trim()}`);
    const archs = exec('lipo', ['-archs', path]);
    const list = archs.stdout.trim().split(/\s+/).filter(Boolean);
    if (archs.status !== 0 || !list.includes('arm64')) {
      failures.push(`${rel(path)}: not built for Apple silicon (lipo -archs: ${list.join(' ') || archs.stderr.trim() || 'nothing'})`);
    }
  }
  return failures;
}

/** The hook. A throw fails the build, which is the point (FR-044). */
async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const failures = signAndCheck(app);
  if (failures.length > 0) {
    throw new Error(`[after-sign] ${failures.length} problem(s) a Mac would refuse to run:\n  ${failures.join('\n  ')}`);
  }
  console.log('[after-sign] every Mach-O is signed and arm64; the bundle verifies');
}

module.exports = { default: afterSign, signAndCheck, findMachOFiles, isMachOHeader };

if (require.main === module) {
  const app = process.argv[2];
  if (!app) {
    console.error('usage: node packaging/macos/after-sign.cjs <throng.app>');
    process.exit(2);
  }
  const failures = signAndCheck(app);
  for (const failure of failures) console.error(`[after-sign] ${failure}`);
  process.exit(failures.length > 0 ? 1 : 0);
}
