// node-pty 1.1.0 publishes its macOS `spawn-helper` as 0644, and node-pty execs it for every terminal it starts, so
// without the execute bit no terminal opens on a Mac (posix_spawn fails with EACCES) — in a dev checkout and on the
// hosted macOS runners alike (070 FR-004). Run as the root `postinstall`; the packaged copy gets the same repair from
// packaging/macos/after-sign.cjs. Does nothing on Windows, which has no execute bit.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Make every `prebuilds/<platform>/spawn-helper` under `root`'s node-pty executable. Answers the paths it changed. */
export function fixNodePtyHelper(root, platform = process.platform) {
  if (platform === 'win32') return [];
  const prebuilds = join(root, 'node_modules', 'node-pty', 'prebuilds');
  if (!existsSync(prebuilds)) return [];
  const changed = [];
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper');
    if (!existsSync(helper)) continue;
    const mode = statSync(helper).mode & 0o777;
    if ((mode & 0o111) === 0o111) continue;
    chmodSync(helper, mode | 0o755);
    changed.push(helper);
  }
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const path of fixNodePtyHelper(root)) console.log(`[fix-node-pty-helper] made executable: ${path}`);
}
