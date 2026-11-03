// electron-builder's afterPack hook (063 research D3): puts the launcher where the Linux binary was, and gives the
// tree the modes a machine-wide install needs. It runs for every platform's build and touches only Linux's.
// CommonJS because electron-builder `require()`s a hook.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chmodSync, copyFileSync, lstatSync, readdirSync, renameSync } = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require('node:path');

/**
 * Nobody but root may write to an installed copy. Electron's own files can arrive world-writable, and the rest carry
 * whatever the build's umask left, and a package would install those modes as they stand. Measured: a build with umask
 * 002 packaged `throng-bin` as 0777.
 */
function normaliseModes(dir) {
  chmodSync(dir, 0o755);
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) normaliseModes(path);
    else chmodSync(path, info.mode & 0o111 ? 0o755 : 0o644);
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const executable = join(context.appOutDir, context.packager.executableName);
  renameSync(executable, join(context.appOutDir, 'throng-bin'));
  copyFileSync(join(__dirname, 'launcher.sh'), executable);
  chmodSync(executable, 0o755);
  normaliseModes(context.appOutDir);
};
